import { useEffect, useId, useState, type FormEvent } from "react"
import { BotIcon, Loader2Icon } from "lucide-react"
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
import { fetchTaskDetails } from "@/services/odooService"
import type { KanbanTask } from "@/types/timesheet"
import {
  CLAUDE_PROMPT_MAX_LENGTH,
  buildClaudeCodeUrl,
  htmlToPlainText,
  readProjectFolder,
  saveProjectFolder,
  truncateText,
} from "@/utils/claudeCode"
import { splitTaskName } from "@/utils/kanban"
import { getTaskUrl } from "@/utils/settings"

/** Room left in the prompt for the description, after the other lines. */
const DESCRIPTION_MAX_LENGTH = CLAUDE_PROMPT_MAX_LENGTH - 1_500

interface ClaudeTaskDialogProps {
  open: boolean
  task: KanbanTask | null
  onOpenChange: (open: boolean) => void
}

type Description =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string }

function ClaudeTaskForm({
  task,
  onOpened,
}: {
  task: KanbanTask
  onOpened: () => void
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
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
            {t("claudeTask.promptHint")}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={prompt.trim() === ""}>
          <BotIcon />
          {t("claudeTask.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Starts a Claude Code session in Claude Desktop on a task: its prompt holds
 * the task and its description, and it works in the project's local folder.
 */
export function ClaudeTaskDialog({
  open,
  task,
  onOpenChange,
}: ClaudeTaskDialogProps) {
  const { t } = useTranslation()

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
            onOpened={handleOpened}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
