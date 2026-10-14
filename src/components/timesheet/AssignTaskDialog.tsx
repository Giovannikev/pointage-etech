import {
  useCallback,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { CheckIcon, Link2Icon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TaskStatusBadge } from "@/components/kanban/TaskStatusBadge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useFormatters } from "@/hooks/useFormatters"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import {
  fetchProjects,
  fetchProjectTasks,
  peekProjects,
  peekProjectTasks,
} from "@/services/odooService"
import type {
  KanbanTask,
  ListProjectsResponse,
  ListProjectTasksResponse,
  OdooInstanceIndex,
  OdooTaskMatch,
  TimesheetEntry,
} from "@/types/timesheet"
import { normalizeText, splitTaskName } from "@/utils/kanban"

/** Mirrors MIN_QUERY_LENGTH in the odoo-gateway Edge Function. */
const MIN_QUERY_LENGTH = 2

/** The project chosen in the picker. */
interface PickedProject {
  projectId: number
  name: string
  partnerName: string | null
}

function matchesWords(haystack: string, search: string): boolean {
  const words = normalizeText(search).split(/\s+/).filter(Boolean)
  const text = normalizeText(haystack)
  return words.every((word) => text.includes(word))
}

function isClosed(task: KanbanTask): boolean {
  return task.status === "done" || task.status === "canceled"
}

function SearchField({
  value,
  onChange,
  placeholder,
  controls,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  controls: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-controls={controls}
        className="pl-8"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function ListSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1.5 p-1" aria-label={t("common.loading")}>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  )
}

function ListError({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid justify-items-start gap-2 p-3 text-sm" role="alert">
      <p className="text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("common.tryAgain")}
      </Button>
    </div>
  )
}

/** A selectable row of the project and task lists. */
function OptionRow({
  isSelected,
  onSelect,
  children,
}: {
  isSelected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={isSelected}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          isSelected && "bg-muted font-medium"
        )}
        onClick={onSelect}
      >
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center"
        >
          {isSelected && <CheckIcon className="size-4 text-primary" />}
        </span>
        {children}
      </button>
    </li>
  )
}

function ProjectList({
  instanceIndex,
  search,
  listId,
  onSelect,
}: {
  instanceIndex: OdooInstanceIndex
  search: string
  listId: string
  onSelect: (project: PickedProject) => void
}) {
  const { t } = useTranslation()
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchProjects(instanceIndex, { force }),
    [instanceIndex]
  )
  const peek = useCallback(() => peekProjects(instanceIndex), [instanceIndex])
  const query = useCachedQuery<ListProjectsResponse>(
    `projects:${instanceIndex}`,
    fetcher,
    peek
  )
  const visible = useMemo(
    () =>
      (query.data?.projects ?? []).filter((project) =>
        matchesWords(`${project.name} ${project.partnerName ?? ""}`, search)
      ),
    [query.data, search]
  )

  if (query.isLoading) return <ListSkeleton />
  if (query.data === undefined) {
    return <ListError message={query.error} onRetry={query.refresh} />
  }

  return (
    <>
      <ul
        id={listId}
        aria-label={t("assignTask.project")}
        className="grid max-h-56 overflow-y-auto rounded-lg border p-1"
      >
        {visible.map((project) => (
          <OptionRow
            key={project.projectId}
            isSelected={false}
            onSelect={() => onSelect(project)}
          >
            <span className="min-w-0 flex-1 truncate" title={project.name}>
              {project.name}
            </span>
            {project.partnerName !== null && (
              <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
                {project.partnerName}
              </span>
            )}
          </OptionRow>
        ))}
        {visible.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.data.projects.length === 0
              ? t("assignTask.noProjects")
              : t("assignTask.noProjectMatch")}
          </li>
        )}
      </ul>
      {query.data.truncated && (
        <p className="text-xs text-muted-foreground">
          {t("assignTask.projectsTruncated")}
        </p>
      )}
    </>
  )
}

function TaskList({
  instanceIndex,
  projectId,
  search,
  listId,
  selectedTaskId,
  onSelect,
}: {
  instanceIndex: OdooInstanceIndex
  projectId: number
  search: string
  listId: string
  selectedTaskId: number | null
  onSelect: (task: KanbanTask) => void
}) {
  const { t } = useTranslation()
  const debouncedSearch = useDebouncedValue(search.trim(), 350)
  // Small projects are filtered here as the user types. When the project has
  // more tasks than one read returns, the search also runs in Odoo.
  const isLargeProject =
    peekProjectTasks(instanceIndex, projectId, "")?.truncated === true
  const serverQuery =
    isLargeProject && debouncedSearch.length >= MIN_QUERY_LENGTH
      ? debouncedSearch
      : ""
  const fetcher = useCallback(
    ({ force }: { force: boolean }) =>
      fetchProjectTasks(instanceIndex, projectId, serverQuery, { force }),
    [instanceIndex, projectId, serverQuery]
  )
  const peek = useCallback(
    () => peekProjectTasks(instanceIndex, projectId, serverQuery),
    [instanceIndex, projectId, serverQuery]
  )
  const query = useCachedQuery<ListProjectTasksResponse>(
    `projectTasks:${instanceIndex}:${projectId}:${serverQuery}`,
    fetcher,
    peek
  )
  const visible = useMemo(() => {
    const tasks = (query.data?.tasks ?? []).filter((task) =>
      matchesWords(`${task.name} #${task.taskId}`, search)
    )
    // Open tasks first; Odoo's order (priority, then latest) is kept otherwise.
    return [
      ...tasks.filter((task) => !isClosed(task)),
      ...tasks.filter(isClosed),
    ]
  }, [query.data, search])

  if (query.isLoading) return <ListSkeleton />
  if (query.data === undefined) {
    return <ListError message={query.error} onRetry={query.refresh} />
  }

  return (
    <>
      <ul
        id={listId}
        aria-label={t("assignTask.task")}
        className="grid max-h-64 overflow-y-auto rounded-lg border p-1"
      >
        {visible.map((task) => {
          const { ref, title } = splitTaskName(task.name)
          return (
            <OptionRow
              key={task.taskId}
              isSelected={task.taskId === selectedTaskId}
              onSelect={() => onSelect(task)}
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate" title={task.name}>
                  {ref !== null && (
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      [{ref}]
                    </span>
                  )}
                  {title}
                </span>
                {(task.stageName !== null ||
                  (task.status !== null && task.status !== "in_progress")) && (
                  <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    {task.stageName !== null && (
                      <span className="truncate">{task.stageName}</span>
                    )}
                    <TaskStatusBadge status={task.status} />
                  </span>
                )}
              </span>
            </OptionRow>
          )
        })}
        {visible.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.data.tasks.length === 0 && serverQuery === ""
              ? t("assignTask.noTasks")
              : t("assignTask.noTaskMatch")}
          </li>
        )}
      </ul>
      {query.data.truncated && (
        <p className="text-xs text-muted-foreground">
          {t("assignTask.tasksTruncated")}
        </p>
      )}
    </>
  )
}

interface AssignTaskFormProps {
  entry: TimesheetEntry
  /** Lines without a task that share this line's reference. */
  sameReferenceLines: TimesheetEntry[]
  onAssign: (ids: string[], task: OdooTaskMatch) => void
}

function AssignTaskForm({
  entry,
  sameReferenceLines,
  onAssign,
}: AssignTaskFormProps) {
  const { t } = useTranslation()
  const { formatShortDate } = useFormatters()
  const instances = useOdooInstances()
  const fieldId = useId()
  const current = entry.task

  const [instanceIndex, setInstanceIndex] = useState<OdooInstanceIndex>(
    current?.instanceIndex ?? instances[0]?.index ?? 1
  )
  const [project, setProject] = useState<PickedProject | null>(
    current === null
      ? null
      : {
          projectId: current.projectId,
          name: current.projectName,
          partnerName: null,
        }
  )
  const [task, setTask] = useState<OdooTaskMatch | null>(current)
  const [projectSearch, setProjectSearch] = useState("")
  const [taskSearch, setTaskSearch] = useState("")
  const [applyToOthers, setApplyToOthers] = useState(true)

  const changeInstance = (next: OdooInstanceIndex): void => {
    if (next === instanceIndex) return
    setInstanceIndex(next)
    setProject(null)
    setTask(null)
    setProjectSearch("")
    setTaskSearch("")
  }

  const changeProject = (next: PickedProject | null): void => {
    setProject(next)
    setTask(null)
    setTaskSearch("")
  }

  const selectTask = (picked: KanbanTask): void => {
    if (project === null) return
    setTask({
      taskId: picked.taskId,
      taskName: picked.name,
      projectId: picked.projectId ?? project.projectId,
      projectName: picked.projectName ?? project.name,
      instanceIndex,
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (task === null) return
    const others = applyToOthers
      ? sameReferenceLines.map((line) => line.id)
      : []
    onAssign([entry.id, ...others], task)
  }

  const isUnchanged =
    task !== null &&
    current !== null &&
    entry.isTaskManual &&
    task.instanceIndex === current.instanceIndex &&
    task.taskId === current.taskId

  return (
    <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle>{t("assignTask.title")}</DialogTitle>
        <DialogDescription>{t("assignTask.description")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatShortDate(entry.date)}</span>
          <span className="font-mono">
            {entry.commit.taskRef ?? t("timesheet.noReference")}
          </span>
        </span>
        <span
          className="truncate font-mono text-xs"
          title={entry.commit.rawMessage}
        >
          {entry.commit.rawMessage}
        </span>
      </div>

      {instances.length > 1 && (
        <div className="grid gap-2">
          <Label id={`${fieldId}-instance`}>{t("assignTask.instance")}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby={`${fieldId}-instance`}
            value={String(instanceIndex)}
            className="flex-wrap"
            onValueChange={(value) => {
              if (value === "1" || value === "2") {
                changeInstance(Number(value) as OdooInstanceIndex)
              }
            }}
          >
            {instances.map((instance) => (
              <ToggleGroupItem
                key={instance.index}
                value={String(instance.index)}
                className="max-w-48"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    INSTANCE_BACKGROUNDS[instance.index]
                  )}
                />
                <span className="truncate">{instance.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <div className="grid gap-2">
        <Label id={`${fieldId}-project`}>{t("assignTask.project")}</Label>
        {project === null ? (
          <div
            className="grid gap-2"
            role="group"
            aria-labelledby={`${fieldId}-project`}
          >
            <SearchField
              value={projectSearch}
              onChange={setProjectSearch}
              placeholder={t("assignTask.searchProject")}
              controls={`${fieldId}-projects`}
              autoFocus
            />
            <ProjectList
              instanceIndex={instanceIndex}
              search={projectSearch}
              listId={`${fieldId}-projects`}
              onSelect={changeProject}
            />
          </div>
        ) : (
          <div
            role="group"
            aria-labelledby={`${fieldId}-project`}
            className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {project.name}
            </span>
            {project.partnerName !== null && (
              <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
                {project.partnerName}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => changeProject(null)}
            >
              {t("assignTask.changeProject")}
            </Button>
          </div>
        )}
      </div>

      {project !== null && (
        <div className="grid gap-2">
          <Label id={`${fieldId}-task`}>{t("assignTask.task")}</Label>
          <div
            className="grid gap-2"
            role="group"
            aria-labelledby={`${fieldId}-task`}
          >
            <SearchField
              value={taskSearch}
              onChange={setTaskSearch}
              placeholder={t("assignTask.searchTask")}
              controls={`${fieldId}-tasks`}
              autoFocus
            />
            <TaskList
              instanceIndex={instanceIndex}
              projectId={project.projectId}
              search={taskSearch}
              listId={`${fieldId}-tasks`}
              selectedTaskId={
                task !== null && task.instanceIndex === instanceIndex
                  ? task.taskId
                  : null
              }
              onSelect={selectTask}
            />
          </div>
        </div>
      )}

      {sameReferenceLines.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={applyToOthers}
            onChange={(event) => setApplyToOthers(event.target.checked)}
          />
          <span>
            {t("assignTask.applyToOthers", {
              count: sameReferenceLines.length,
              taskRef: entry.commit.taskRef,
            })}
          </span>
        </label>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={task === null || isUnchanged}>
          <Link2Icon />
          {t("assignTask.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface AssignTaskDialogProps {
  open: boolean
  /** The line whose task is picked; null while closed. */
  entry: TimesheetEntry | null
  sameReferenceLines: TimesheetEntry[]
  onOpenChange: (open: boolean) => void
  /** Called with the lines to attach; the dialog closes right away. */
  onAssign: (ids: string[], task: OdooTaskMatch) => void
}

/**
 * Picks the task of a commit by hand: instance, then project, then task.
 * Used when the commit's reference isn't found, or to log it elsewhere.
 */
export function AssignTaskDialog({
  open,
  entry,
  sameReferenceLines,
  onOpenChange,
  onAssign,
}: AssignTaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {entry !== null && (
          <AssignTaskForm
            key={entry.id}
            entry={entry}
            sameReferenceLines={sameReferenceLines}
            onAssign={onAssign}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
