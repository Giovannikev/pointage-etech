import { useCallback, useEffect, useId, useState, type FormEvent } from "react"
import { BotIcon, Loader2Icon, MonitorUpIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useFormatters } from "@/hooks/useFormatters"
import { useNow } from "@/hooks/useNow"
import { cn } from "@/lib/utils"
import {
  createClaudeJob,
  fetchClaudeAgent,
  fetchClaudeJob,
  type ClaudeAgent,
  type ClaudeJob,
} from "@/services/claudeJobService"
import { fetchTaskDetails } from "@/services/odooService"
import type { KanbanTask } from "@/types/timesheet"
import {
  CLAUDE_PROMPT_MAX_LENGTH,
  buildClaudeCodeUrl,
  htmlToPlainText,
  isAgentOnline,
  isJobExpired,
  readProjectFolder,
  saveProjectFolder,
  truncateText,
} from "@/utils/claudeCode"
import { splitTaskName } from "@/utils/kanban"
import { getTaskUrl } from "@/utils/settings"

/** Room left in the prompt for the description, after the other lines. */
const DESCRIPTION_MAX_LENGTH = CLAUDE_PROMPT_MAX_LENGTH - 1_500
/** How often a sent job is read back, until the computer started it. */
const JOB_POLL_MS = 2_500

interface ClaudeTaskDialogProps {
  open: boolean
  task: KanbanTask | null
  /**
   * Sends the job to the Claude agent of the user's computer instead of
   * opening Claude Desktop here (a phone has no Claude Desktop).
   */
  remote: boolean
  onOpenChange: (open: boolean) => void
}

type AgentState =
  | { status: "loading" }
  | { status: "ready"; agent: ClaudeAgent | null }
  | { status: "error"; message: string }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The user's agent, read once when the dialog opens in remote mode. */
function useClaudeAgent(enabled: boolean): AgentState {
  const [state, setState] = useState<AgentState>({ status: "loading" })
  useEffect(() => {
    if (!enabled) return
    let isCurrent = true
    fetchClaudeAgent().then(
      (agent) => isCurrent && setState({ status: "ready", agent }),
      (error: unknown) =>
        isCurrent && setState({ status: "error", message: errorText(error) })
    )
    return () => {
      isCurrent = false
    }
  }, [enabled])
  return state
}

/** Where the computer is with a sent job, or whether it can take one. */
function RemoteStatus({
  agentState,
  job,
  sendError,
}: {
  agentState: AgentState
  job: ClaudeJob | null
  sendError: string | null
}) {
  const { t } = useTranslation()
  const { formatTime } = useFormatters()
  const now = useNow().getTime()

  const line = (
    text: string,
    tone: "muted" | "success" | "warning" | "error" = "muted",
    busy = false
  ) => (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-sm",
        tone === "muted" && "text-muted-foreground",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "error" && "text-destructive"
      )}
    >
      {busy ? (
        <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin" />
      ) : (
        <MonitorUpIcon className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{text}</span>
    </p>
  )

  if (sendError !== null) {
    return line(
      t("claudeTask.remote.sendError", { message: sendError }),
      "error"
    )
  }
  if (job !== null) {
    const host = job.agentHost ?? t("claudeTask.remote.yourComputer")
    if (job.status === "failed") {
      return line(
        t("claudeTask.remote.failed", { host, message: job.error ?? "" }),
        "error"
      )
    }
    if (job.status === "launching") {
      return line(t("claudeTask.remote.launching", { host }), "muted", true)
    }
    if (job.status === "pending" && isJobExpired(job.createdAt, now)) {
      return line(t("claudeTask.remote.expired"), "error")
    }
    if (job.status === "pending") {
      return line(t("claudeTask.remote.waiting"), "muted", true)
    }
  }
  if (agentState.status === "loading") {
    return line(t("claudeTask.remote.lookingForAgent"), "muted", true)
  }
  if (agentState.status === "error") {
    return line(
      t("claudeTask.remote.agentError", { message: agentState.message }),
      "error"
    )
  }
  const { agent } = agentState
  if (agent === null) {
    return line(t("claudeTask.remote.noAgent"), "warning")
  }
  return isAgentOnline(agent.lastSeenAt, now)
    ? line(t("claudeTask.remote.online", { host: agent.host }), "success")
    : line(
        t("claudeTask.remote.offline", {
          host: agent.host,
          time: formatTime(agent.lastSeenAt),
        }),
        "warning"
      )
}

type Description =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string }

function ClaudeTaskForm({
  task,
  remote,
  onOpened,
  onLaunched,
}: {
  task: KanbanTask
  remote: boolean
  onOpened: () => void
  /** The computer started the session. */
  onLaunched: (job: ClaudeJob) => void
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const instances = useOdooInstances()
  const [folder, setFolder] = useState(() => readProjectFolder(task))
  const [description, setDescription] = useState<Description>({
    status: "loading",
  })
  // null until the user edits it: the prompt follows the description until then.
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null)
  const agentState = useClaudeAgent(remote)
  const now = useNow().getTime()
  const [job, setJob] = useState<ClaudeJob | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Reads the sent job back until the computer started it or gave up.
  const jobId = job?.id ?? null
  const isJobWaiting = job?.status === "pending" || job?.status === "launching"
  useEffect(() => {
    if (jobId === null || !isJobWaiting) return
    const timer = window.setInterval(() => {
      fetchClaudeJob(jobId).then(
        (next) => {
          setJob(next)
          if (next.status === "started") onLaunched(next)
        },
        () => {
          // Read again at the next tick.
        }
      )
    }, JOB_POLL_MS)
    return () => window.clearInterval(timer)
  }, [jobId, isJobWaiting, onLaunched])

  useEffect(() => {
    let isCurrent = true
    fetchTaskDetails(task.instanceIndex, task.taskId).then(
      (details) => {
        if (isCurrent) {
          setDescription({
            status: "ready",
            text: htmlToPlainText(details.descriptionHtml),
          })
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setDescription({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    )
    return () => {
      isCurrent = false
    }
  }, [task.instanceIndex, task.taskId])

  const { ref, title } = splitTaskName(task.name)
  const url = getTaskUrl(instances, {
    taskId: task.taskId,
    taskName: task.name,
    projectId: task.projectId ?? 0,
    projectName: task.projectName ?? "",
    instanceIndex: task.instanceIndex,
  })
  const descriptionText = description.status === "ready" ? description.text : ""
  const defaultPrompt = [
    t("claudeTask.promptIntro", { task: task.name }),
    "",
    task.projectName !== null &&
      t("claudeTask.promptProject", { project: task.projectName }),
    task.stageName !== null &&
      t("claudeTask.promptStage", { stage: task.stageName }),
    url !== null && t("claudeTask.promptLink", { url }),
    descriptionText !== "" && "",
    descriptionText !== "" && t("claudeTask.promptDescription"),
    descriptionText !== "" &&
      truncateText(descriptionText, DESCRIPTION_MAX_LENGTH),
    "",
    t("claudeTask.promptOutro"),
  ]
    .filter((line) => line !== false)
    .join("\n")
  const prompt = editedPrompt ?? defaultPrompt
  const isLoading = description.status === "loading" && editedPrompt === null

  const canSendRemote =
    agentState.status === "ready" &&
    agentState.agent !== null &&
    !isSending &&
    !(isJobWaiting && !isJobExpired(job?.createdAt ?? "", now))

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (remote) {
      if (!canSendRemote) return
      setIsSending(true)
      setSendError(null)
      createClaudeJob(task, prompt.trim().slice(0, CLAUDE_PROMPT_MAX_LENGTH))
        .then(setJob, (error: unknown) => setSendError(errorText(error)))
        .finally(() => setIsSending(false))
      return
    }
    saveProjectFolder(task, folder)
    // A custom scheme: the browser hands it to Claude Desktop, the page stays.
    window.location.href = buildClaudeCodeUrl(prompt, folder)
    onOpened()
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("claudeTask.title")}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InstanceBadge instanceIndex={task.instanceIndex} />
            {task.projectName !== null && (
              <span className="truncate">{task.projectName}</span>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      <p className="leading-snug font-medium">
        {ref !== null && (
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            [{ref}]
          </span>
        )}
        {title}
      </p>

      {remote ? (
        <RemoteStatus agentState={agentState} job={job} sendError={sendError} />
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-folder`}>{t("claudeTask.folder")}</Label>
          <Input
            id={`${fieldId}-folder`}
            value={folder}
            placeholder={t("claudeTask.folderPlaceholder")}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
            onChange={(event) => setFolder(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("claudeTask.folderHint")}
          </p>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-prompt`}>{t("claudeTask.prompt")}</Label>
        <Textarea
          id={`${fieldId}-prompt`}
          value={prompt}
          className="max-h-[45vh] min-h-48 font-mono text-xs"
          onChange={(event) => setEditedPrompt(event.target.value)}
        />
        {isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("claudeTask.loadingDescription")}
          </p>
        ) : description.status === "error" ? (
          <p className="text-xs text-warning" role="status">
            {t("claudeTask.descriptionError", {
              message: description.message,
            })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {remote
              ? t("claudeTask.remote.promptHint")
              : t("claudeTask.promptHint")}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        {remote ? (
          <Button
            type="submit"
            disabled={prompt.trim() === "" || !canSendRemote}
          >
            {isSending || isJobWaiting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <MonitorUpIcon />
            )}
            {t("claudeTask.remote.submit")}
          </Button>
        ) : (
          <Button type="submit" disabled={prompt.trim() === ""}>
            <BotIcon />
            {t("claudeTask.submit")}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

/**
 * Starts a Claude Code session on a task: its prompt holds the task and its
 * description. On a computer, Claude Desktop opens it in the project's local
 * folder; from a phone, the Claude agent of the user's computer starts it
 * there, to be followed in the Claude app through Remote Control.
 */
export function ClaudeTaskDialog({
  open,
  task,
  remote,
  onOpenChange,
}: ClaudeTaskDialogProps) {
  const { t } = useTranslation()

  const handleLaunched = useCallback(
    (job: ClaudeJob): void => {
      onOpenChange(false)
      toast.success(
        t("claudeTask.remote.started", {
          host: job.agentHost ?? t("claudeTask.remote.yourComputer"),
        }),
        {
          description: t("claudeTask.remote.startedHint", {
            name: job.sessionName ?? "",
          }),
        }
      )
    },
    [onOpenChange, t]
  )

  const handleOpened = (): void => {
    onOpenChange(false)
    toast.success(t("claudeTask.opened"), {
      description: t("claudeTask.openedHint"),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {task !== null && (
          <ClaudeTaskForm
            key={`${task.instanceIndex}:${task.taskId}`}
            task={task}
            remote={remote}
            onOpened={handleOpened}
            onLaunched={handleLaunched}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
