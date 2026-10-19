import {
  useCallback,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  CheckIcon,
  FolderKanbanIcon,
  LifeBuoyIcon,
  Link2Icon,
  SearchIcon,
  StarIcon,
} from "lucide-react"
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
  peekTickets,
  searchTickets,
} from "@/services/odooService"
import type {
  HelpdeskTicket,
  KanbanTask,
  ListProjectsResponse,
  ListProjectTasksResponse,
  OdooInstanceIndex,
  OdooTaskMatch,
  TicketsInstanceResult,
  TimesheetEntry,
} from "@/types/timesheet"
import {
  matchesTicketSearch,
  normalizeText,
  splitTaskName,
} from "@/utils/kanban"
import {
  isSameMatch,
  isTicketMatch,
  ticketLabel,
  toTicketMatch,
} from "@/utils/timesheetTarget"

/** Mirrors MIN_QUERY_LENGTH in the odoo-gateway Edge Function. */
const MIN_QUERY_LENGTH = 2

/** What the commit is logged on: a project task or a helpdesk ticket. */
type TargetKind = "task" | "ticket"

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
  disabled = false,
  children,
}: {
  isSelected: boolean
  onSelect: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={isSelected}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
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

/** Tickets of one instance among the results of every instance. */
function instanceTickets(
  results: TicketsInstanceResult[] | undefined,
  instanceIndex: OdooInstanceIndex
): TicketsInstanceResult | undefined {
  return results?.find((result) => result.instanceIndex === instanceIndex)
}

function TicketRow({
  ticket,
  isSelected,
  onSelect,
}: {
  ticket: HelpdeskTicket
  isSelected: boolean
  onSelect: (ticket: HelpdeskTicket) => void
}) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const team = ticket.teamName ?? ticket.projectName
  return (
    <OptionRow
      isSelected={isSelected}
      disabled={!ticket.loggable}
      onSelect={() => onSelect(ticket)}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {ticketLabel(ticket)}
          </span>
          {ticket.priority > 0 && (
            <StarIcon
              className="size-3 shrink-0 fill-warning text-warning"
              aria-label={t("kanban.starred")}
            />
          )}
          <span className="truncate" title={ticket.name}>
            {ticket.name}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground">
          {ticket.stageName !== null && (
            <span className="shrink-0 rounded-sm bg-muted px-1 leading-4">
              {ticket.stageName}
            </span>
          )}
          {team !== null && <span className="truncate">{team}</span>}
          {ticket.projectName !== null &&
            ticket.teamName !== null &&
            ticket.projectName !== ticket.teamName && (
              <span className="truncate">{ticket.projectName}</span>
            )}
          {ticket.hoursSpent !== null && ticket.hoursSpent > 0 && (
            <span className="ml-auto shrink-0 tabular-nums">
              {formatHours(ticket.hoursSpent)}
            </span>
          )}
        </span>
        {!ticket.loggable && (
          <span className="text-xs font-normal text-muted-foreground">
            {t("assignTask.ticketNotLoggable")}
          </span>
        )}
      </span>
    </OptionRow>
  )
}

/**
 * The user's open tickets of the instance, or, from 2 characters typed,
 * every open ticket matching the search (title, reference or #id).
 */
function TicketList({
  instanceIndex,
  search,
  listId,
  selectedTicketId,
  onSelect,
}: {
  instanceIndex: OdooInstanceIndex
  search: string
  listId: string
  selectedTicketId: number | null
  onSelect: (ticket: HelpdeskTicket) => void
}) {
  const { t } = useTranslation()
  const debouncedSearch = useDebouncedValue(search.trim(), 350)
  const serverQuery =
    debouncedSearch.length >= MIN_QUERY_LENGTH ? debouncedSearch : ""
  const mine = serverQuery === ""
  const fetcher = useCallback(
    ({ force }: { force: boolean }) =>
      searchTickets(serverQuery, mine, { force }),
    [serverQuery, mine]
  )
  const peek = useCallback(
    () => peekTickets(serverQuery, mine),
    [serverQuery, mine]
  )
  const query = useCachedQuery<TicketsInstanceResult[]>(
    `pickerTickets:${mine ? "mine" : "all"}:${serverQuery}`,
    fetcher,
    peek
  )
  const result = instanceTickets(query.data, instanceIndex)
  const visible = useMemo(() => {
    if (result === undefined || !result.ok) return []
    // The user's own tickets are filtered here as they type; a search in
    // Odoo already matched its results.
    const tickets = mine
      ? result.tickets.filter((ticket) => matchesTicketSearch(ticket, search))
      : result.tickets
    // Tickets time can be logged on first; Odoo's order is kept otherwise.
    return [
      ...tickets.filter((ticket) => ticket.loggable),
      ...tickets.filter((ticket) => !ticket.loggable),
    ]
  }, [result, mine, search])

  if (query.isLoading) return <ListSkeleton />
  if (query.data === undefined) {
    return <ListError message={query.error} onRetry={query.refresh} />
  }
  if (result !== undefined && !result.ok) {
    return <ListError message={result.error} onRetry={query.refresh} />
  }
  if (result === undefined || !result.available) {
    return (
      <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
        {t("assignTask.noHelpdesk")}
      </p>
    )
  }

  return (
    <>
      <ul
        id={listId}
        aria-label={t("assignTask.ticket")}
        className="grid max-h-72 overflow-y-auto rounded-lg border p-1"
      >
        {visible.map((ticket) => (
          <TicketRow
            key={ticket.ticketId}
            ticket={ticket}
            isSelected={ticket.ticketId === selectedTicketId}
            onSelect={onSelect}
          />
        ))}
        {visible.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {mine && search.trim() === ""
              ? t("assignTask.noTickets")
              : t("assignTask.noTicketMatch")}
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">
        {mine ? t("assignTask.myTicketsHint") : t("assignTask.allTicketsHint")}
        {result.truncated && ` ${t("assignTask.ticketsTruncated")}`}
      </p>
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
    current === null || isTicketMatch(current)
      ? null
      : {
          projectId: current.projectId,
          name: current.projectName,
          partnerName: null,
        }
  )
  const [kind, setKind] = useState<TargetKind>(
    current !== null && isTicketMatch(current) ? "ticket" : "task"
  )
  const [task, setTask] = useState<OdooTaskMatch | null>(current)
  const [projectSearch, setProjectSearch] = useState("")
  const [taskSearch, setTaskSearch] = useState("")
  const [ticketSearch, setTicketSearch] = useState("")
  const [applyToOthers, setApplyToOthers] = useState(true)

  const changeInstance = (next: OdooInstanceIndex): void => {
    if (next === instanceIndex) return
    setInstanceIndex(next)
    setProject(null)
    setTask(null)
    setProjectSearch("")
    setTaskSearch("")
    setTicketSearch("")
  }

  const changeKind = (next: TargetKind): void => {
    if (next === kind) return
    setKind(next)
    // The line's current target stays picked when going back to its kind.
    const keepsCurrent =
      current !== null &&
      current.instanceIndex === instanceIndex &&
      isTicketMatch(current) === (next === "ticket")
    setTask(keepsCurrent ? current : null)
  }

  const selectTicket = (picked: HelpdeskTicket): void => {
    const match = toTicketMatch(picked)
    if (match !== null) {
      setTask(match)
    }
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
    isSameMatch(task, current)
  const selectedTicketId =
    task !== null && isTicketMatch(task) && task.instanceIndex === instanceIndex
      ? task.ticket.ticketId
      : null

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
        <Label id={`${fieldId}-kind`}>{t("assignTask.kindLabel")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby={`${fieldId}-kind`}
          value={kind}
          className="flex-wrap"
          onValueChange={(value) => {
            if (value === "task" || value === "ticket") {
              changeKind(value)
            }
          }}
        >
          <ToggleGroupItem value="task">
            <FolderKanbanIcon />
            {t("assignTask.kinds.task")}
          </ToggleGroupItem>
          <ToggleGroupItem value="ticket">
            <LifeBuoyIcon />
            {t("assignTask.kinds.ticket")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {kind === "ticket" && (
        <div className="grid gap-2">
          <Label id={`${fieldId}-ticket`}>{t("assignTask.ticket")}</Label>
          <div
            className="grid gap-2"
            role="group"
            aria-labelledby={`${fieldId}-ticket`}
          >
            <SearchField
              value={ticketSearch}
              onChange={setTicketSearch}
              placeholder={t("assignTask.searchTicket")}
              controls={`${fieldId}-tickets`}
              autoFocus
            />
            <TicketList
              instanceIndex={instanceIndex}
              search={ticketSearch}
              listId={`${fieldId}-tickets`}
              selectedTicketId={selectedTicketId}
              onSelect={selectTicket}
            />
          </div>
        </div>
      )}

      {kind === "task" && (
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
      )}

      {kind === "task" && project !== null && (
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
                task !== null &&
                !isTicketMatch(task) &&
                task.instanceIndex === instanceIndex
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
          {kind === "ticket"
            ? t("assignTask.submitTicket")
            : t("assignTask.submit")}
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
 * Picks the target of a commit by hand: instance, then a project and one of
 * its tasks, or a helpdesk ticket. Used when the commit's reference isn't
 * found, or to log it elsewhere.
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
