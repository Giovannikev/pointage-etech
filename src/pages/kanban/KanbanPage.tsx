import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArchiveIcon,
  Columns3Icon,
  LifeBuoyIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { CardEditing } from "@/components/kanban/KanbanCard"
import { KanbanColumn, type ColumnDrop } from "@/components/kanban/KanbanColumn"
import { ProjectFilter } from "@/components/kanban/ProjectFilter"
import {
  QuickLogDialog,
  type QuickLogResult,
} from "@/components/kanban/QuickLogDialog"
import { SettingsGate } from "@/components/settings/SettingsGate"
import { type LogTarget } from "@/components/timesheet/logTarget"
import {
  InstanceFilter,
  type InstanceFilterValue,
} from "@/components/timesheet/InstanceFilter"
import { InstanceErrorNotice } from "@/components/timesheet/InstanceErrorNotice"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"
import { TaskDetailsDialog } from "@/components/timesheet/TaskDetailsDialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { useTaskDetails } from "@/hooks/useTaskDetails"
import { useSyncViewParams } from "@/hooks/useViewParams"
import { cn } from "@/lib/utils"
import {
  fetchMyTasks,
  peekMyTasks,
  peekTickets,
  searchTickets,
  updateTask,
} from "@/services/odooService"
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  MyTasksInstanceResult,
  OdooTaskMatch,
  TicketsInstanceResult,
} from "@/types/timesheet"
import {
  buildBoard,
  countClosedTasks,
  findColumnStage,
  isClosedTask,
  listMoveTargets,
  listProjects,
  listTickets,
  moveToStage,
  replaceTask,
  statusOptionsOf,
  taskKey,
  type BoardColumn,
  type BoardGrouping,
} from "@/utils/kanban"
import {
  formatInstanceParam,
  parseInstanceParam,
  readViewParams,
} from "@/utils/viewParams"

/** "1:12" (instance:project id) or "none". */
const PROJECT_KEY_PARAM = /^(?:[12]:\d+|none)$/

/** The board's filters as found in the URL when the page opens. */
function readInitialFilters() {
  const params = readViewParams()
  return {
    instance: parseInstanceParam(params.get("instance")),
    query: params.get("q") ?? "",
    projects: new Set(
      (params.get("projects") ?? "")
        .split(",")
        .filter((key) => PROJECT_KEY_PARAM.test(key))
    ),
    groupBy: (params.get("group") === "project"
      ? "project"
      : "stage") as BoardGrouping,
    showClosed: params.get("closed") === "1",
    showTickets: params.get("tickets") !== "0",
  }
}

const MY_TASKS_QUERY_KEY = "myTasks"
/** Same key as the Tasks page's "My open tickets": both share one read. */
const MY_TICKETS_QUERY_KEY = "tickets:mine:"

const fetchMyTickets = ({
  force,
}: {
  force: boolean
}): Promise<TicketsInstanceResult[]> => searchTickets("", true, { force })
const peekMyTickets = (): TicketsInstanceResult[] | undefined =>
  peekTickets("", true)

function BoardSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      className="flex gap-3 overflow-hidden"
      aria-label={t("common.loading")}
    >
      {[4, 3, 2].map((cards, column) => (
        <div
          key={column}
          className="grid w-72 shrink-0 content-start gap-2 rounded-xl bg-muted/50 p-3 sm:w-80"
        >
          <Skeleton className="mb-1 h-4 w-28" />
          {Array.from({ length: cards }, (_, card) => (
            <Skeleton key={card} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Converts a board task for the shared task details dialog. */
function toTaskMatch(task: KanbanTask): OdooTaskMatch {
  return {
    taskId: task.taskId,
    taskName: task.name,
    projectId: task.projectId ?? 0,
    projectName: task.projectName ?? "",
    instanceIndex: task.instanceIndex,
  }
}

function KanbanWorkspace() {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  const instances = useOdooInstances()
  const [initial] = useState(readInitialFilters)
  const [instance, setInstance] = useState<InstanceFilterValue>(
    initial.instance
  )
  const [query, setQuery] = useState(initial.query)
  /** Selected project keys; empty means every project. */
  const [projects, setProjects] = useState<ReadonlySet<string>>(
    initial.projects
  )
  const [groupBy, setGroupBy] = useState<BoardGrouping>(initial.groupBy)
  const [showClosed, setShowClosed] = useState(initial.showClosed)
  const [showTickets, setShowTickets] = useState(initial.showTickets)

  useSyncViewParams("kanban", {
    instance: formatInstanceParam(instance),
    q: query.trim(),
    projects: [...projects].sort().join(","),
    group: groupBy === "project" ? "project" : null,
    closed: showClosed ? "1" : null,
    tickets: showTickets ? null : "0",
  })
  /** Columns whose folded state the user flipped, keyed by column key. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set())
  const quickLog = useDialogTarget<LogTarget>()
  const taskDetails = useTaskDetails()

  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchMyTasks({ force }),
    []
  )
  const tasksQuery = useCachedQuery<MyTasksInstanceResult[]>(
    MY_TASKS_QUERY_KEY,
    fetcher,
    peekMyTasks
  )
  const { data } = tasksQuery
  // The user's open helpdesk tickets, shown on the board next to the tasks.
  const ticketsQuery = useCachedQuery<TicketsInstanceResult[]>(
    MY_TICKETS_QUERY_KEY,
    fetchMyTickets,
    peekMyTickets
  )
  const ticketResults = ticketsQuery.data
  /** At least one instance has a helpdesk: the tickets toggle makes sense. */
  const hasHelpdesk = (ticketResults ?? []).some(
    (result) => result.ok && result.available
  )
  const tickets = useMemo(
    () => (showTickets ? listTickets(ticketResults, instance) : []),
    [showTickets, ticketResults, instance]
  )
  const { refresh: refreshTasks } = tasksQuery
  const { refresh: refreshTickets } = ticketsQuery
  const refresh = useCallback((): void => {
    refreshTasks()
    refreshTickets()
  }, [refreshTasks, refreshTickets])
  const isRefreshing = tasksQuery.isRefreshing || ticketsQuery.isRefreshing

  const projectOptions = useMemo(
    () =>
      data === undefined
        ? []
        : listProjects(data, { instance, showClosed }, tickets),
    [data, instance, showClosed, tickets]
  )
  const columns = useMemo(
    () =>
      data === undefined
        ? []
        : buildBoard(
            data,
            {
              instance,
              showClosed,
              query,
              projects,
              groupBy,
            },
            tickets
          ),
    [data, instance, showClosed, query, projects, groupBy, tickets]
  )
  const closedCount = useMemo(
    () => (data === undefined ? 0 : countClosedTasks(data, instance)),
    [data, instance]
  )

  // Another instance has other projects: the selection no longer applies.
  const changeInstance = (next: InstanceFilterValue): void => {
    setInstance(next)
    setProjects(new Set())
  }
  const failures = (data ?? []).filter(
    (result): result is Extract<MyTasksInstanceResult, { ok: false }> =>
      !result.ok
  )
  // A ticket read failing on an instance whose tasks failed too is the same
  // problem: it is reported once, above.
  const ticketFailures = (ticketResults ?? []).filter(
    (result): result is Extract<TicketsInstanceResult, { ok: false }> =>
      !result.ok &&
      !failures.some(
        (failure) => failure.instanceIndex === result.instanceIndex
      )
  )
  const isTruncated = (data ?? []).some(
    (result) => result.ok && result.truncated
  )
  const areTicketsTruncated =
    showTickets &&
    (ticketResults ?? []).some((result) => result.ok && result.truncated)
  const cards = columns.flatMap((column) => column.cards)
  const taskCount = cards.filter((card) => card.kind === "task").length
  const ticketCount = cards.length - taskCount
  const hasAnyTask =
    (data ?? []).some((result) => result.ok && result.tasks.length > 0) ||
    tickets.length > 0

  const toggleColumn = useCallback((key: string): void => {
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  /* ---- Editing: stage (drag and drop, menu) and state (badge) ---- */

  const { mutate: mutateTasks } = tasksQuery
  /** Tasks whose change is being saved in Odoo, by taskKey(). */
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set())
  /** The card being dragged, while it is. */
  const [dragged, setDragged] = useState<KanbanTask | null>(null)

  const setSavingFor = useCallback((key: string, isSaving: boolean): void => {
    setSaving((current) => {
      const next = new Set(current)
      if (isSaving) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /**
   * Shows the change at once, saves it in Odoo, then shows the task as Odoo
   * holds it (moving may reset its state); on failure, puts it back.
   */
  const saveTask = useCallback(
    async (
      before: KanbanTask,
      optimistic: KanbanTask,
      change: { stageId?: number; status?: KanbanTaskStatus }
    ): Promise<KanbanTask> => {
      const key = taskKey(before)
      setSavingFor(key, true)
      mutateTasks((results) => replaceTask(results, optimistic))
      try {
        const saved = await updateTask({
          instanceIndex: before.instanceIndex,
          taskId: before.taskId,
          ...change,
        })
        mutateTasks((results) => replaceTask(results, saved))
        return saved
      } catch (error) {
        mutateTasks((results) => replaceTask(results, before))
        throw error
      } finally {
        setSavingFor(key, false)
      }
    },
    [mutateTasks, setSavingFor]
  )

  /** The latest moveTask, for the "Undo" button of a move's notification. */
  const moveTaskRef = useRef<
    ((task: KanbanTask, stage: KanbanStage) => Promise<void>) | null
  >(null)

  const moveTask = useCallback(
    async (task: KanbanTask, stage: KanbanStage): Promise<void> => {
      const previous =
        data === undefined
          ? undefined
          : listMoveTargets(data, moveToStage(task, stage)).find(
              (candidate) => candidate.stageId === task.stageId
            )
      try {
        const saved = await saveTask(task, moveToStage(task, stage), {
          stageId: stage.stageId,
        })
        const isHidden = !showClosed && isClosedTask(saved, stage)
        toast.success(t("kanban.moved", { stage: stage.name }), {
          description: isHidden
            ? `${task.name} — ${t("kanban.movedHidden")}`
            : task.name,
          action:
            previous === undefined
              ? undefined
              : {
                  label: t("kanban.undo"),
                  onClick: () => void moveTaskRef.current?.(saved, previous),
                },
        })
      } catch (error) {
        toast.error(t("kanban.moveError"), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [data, saveTask, showClosed, t]
  )

  useEffect(() => {
    moveTaskRef.current = moveTask
  }, [moveTask])

  const changeStatus = useCallback(
    async (task: KanbanTask, status: KanbanTaskStatus): Promise<void> => {
      try {
        const saved = await saveTask(task, { ...task, status }, { status })
        const label = t(`kanban.status.${saved.status ?? "in_progress"}`)
        toast.success(t("kanban.statusChanged", { status: label }), {
          description: task.name,
        })
      } catch (error) {
        toast.error(t("kanban.statusError"), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [saveTask, t]
  )

  const cardEditing = useCallback(
    (task: KanbanTask): CardEditing => ({
      statusOptions: statusOptionsOf(data, task.instanceIndex),
      getMoveTargets: (current) =>
        data === undefined ? [] : listMoveTargets(data, current),
      isSaving: saving.has(taskKey(task)),
      // Dropping changes the stage: only columns that are stages accept it.
      isDraggable: groupBy === "stage" && task.projectId !== null,
      onChangeStatus: (current, status) => void changeStatus(current, status),
      onMove: (current, stage) => void moveTask(current, stage),
      onDragStart: setDragged,
      onDragEnd: () => setDragged(null),
    }),
    [data, saving, groupBy, changeStatus, moveTask]
  )

  const columnDrop = (column: BoardColumn): ColumnDrop | undefined => {
    if (dragged === null || data === undefined) return undefined
    const draggedKey = taskKey(dragged)
    return {
      stage: findColumnStage(data, dragged, column.key),
      isSource: column.cards.some(
        (card) => card.kind === "task" && taskKey(card.task) === draggedKey
      ),
      onDrop: (stage) => {
        const task = dragged
        setDragged(null)
        void moveTask(task, stage)
      },
    }
  }

  const handleLogged = ({ target, hours, date }: QuickLogResult): void => {
    quickLog.close()
    toast.success(
      t("quickLog.logged", {
        hours: formatHours(hours),
        date: formatShortDate(date),
      }),
      { description: target.name }
    )
    // Logged hours changed in Odoo: read the tasks and tickets again.
    refresh()
  }

  const renderBoard = () => {
    if (tasksQuery.isLoading) {
      return <BoardSkeleton />
    }
    if (data === undefined) {
      return (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>{t("kanban.loadError")}</EmptyTitle>
            <EmptyDescription>{tasksQuery.error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={refresh} disabled={isRefreshing}>
              {t("common.tryAgain")}
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    if (columns.length === 0) {
      return (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Columns3Icon />
            </EmptyMedia>
            <EmptyTitle>
              {hasAnyTask ? t("kanban.noMatch") : t("kanban.emptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {hasAnyTask
                ? t("kanban.noMatchHint")
                : t("kanban.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          {hasAnyTask && (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("")
                  setInstance("all")
                  setProjects(new Set())
                  setShowClosed(true)
                  setShowTickets(true)
                }}
              >
                {t("common.clearFilters")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )
    }
    return (
      // Bleeds to the page edges so the columns scroll under the padding.
      <div
        className="-mx-4 overflow-x-auto px-4 pb-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        tabIndex={0}
        role="region"
        aria-label={t("kanban.boardLabel")}
      >
        <div className="flex w-max items-start gap-3">
          {columns.map((column) => (
            <KanbanColumn
              key={column.key}
              column={column}
              isCollapsed={column.folded !== toggled.has(column.key)}
              showInstance={instance === "all" && instances.length > 1}
              onToggleCollapsed={toggleColumn}
              onOpenTask={(task) => taskDetails.open(toTaskMatch(task))}
              onLogTime={quickLog.open}
              cardEditing={cardEditing}
              drop={columnDrop(column)}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("kanban.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {data === undefined
                ? t("kanban.subtitle")
                : ticketCount === 0
                  ? t(
                      groupBy === "project"
                        ? "kanban.summaryByProject"
                        : "kanban.summary",
                      { count: taskCount, columns: columns.length }
                    )
                  : t(
                      groupBy === "project"
                        ? "kanban.summaryWithTicketsByProject"
                        : "kanban.summaryWithTickets",
                      {
                        tasks: t("kanban.taskCount", { count: taskCount }),
                        tickets: t("kanban.ticketCount", {
                          count: ticketCount,
                        }),
                        count: columns.length,
                      }
                    )}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("kanban.refresh")}
                onClick={refresh}
                disabled={tasksQuery.isLoading || isRefreshing}
              >
                <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("kanban.refresh")}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <InstanceFilter value={instance} onChange={changeInstance} />
          {projectOptions.length > 0 && (
            <ProjectFilter
              options={projectOptions}
              value={projects}
              onChange={setProjects}
              showInstance={instance === "all" && instances.length > 1}
            />
          )}
          <div className="relative w-full sm:w-72">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              placeholder={t("kanban.searchPlaceholder")}
              aria-label={t("kanban.search")}
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t("kanban.groupBy.label")}
            value={groupBy}
            onValueChange={(value) => {
              if (value === "stage" || value === "project") {
                setGroupBy(value)
              }
            }}
          >
            <ToggleGroupItem value="stage">
              {t("kanban.groupBy.stage")}
            </ToggleGroupItem>
            <ToggleGroupItem value="project">
              {t("kanban.groupBy.project")}
            </ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            variant="outline"
            size="sm"
            pressed={showClosed}
            onPressedChange={setShowClosed}
          >
            <ArchiveIcon />
            {t("kanban.showClosed")}
          </Toggle>
          {hasHelpdesk && (
            <Toggle
              variant="outline"
              size="sm"
              pressed={showTickets}
              onPressedChange={setShowTickets}
            >
              <LifeBuoyIcon />
              {t("kanban.showTickets")}
            </Toggle>
          )}
          {!showClosed && closedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("kanban.closedHidden", { count: closedCount })}
            </span>
          )}
        </div>

        {failures.map((failure) => (
          <InstanceErrorNotice
            key={failure.instanceIndex}
            instanceIndex={failure.instanceIndex}
            message={failure.error}
          />
        ))}
        {showTickets &&
          ticketFailures.map((failure) => (
            <InstanceErrorNotice
              key={`tickets:${failure.instanceIndex}`}
              instanceIndex={failure.instanceIndex}
              message={failure.error}
            />
          ))}
        {data !== undefined && tasksQuery.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t("kanban.refreshError", { message: tasksQuery.error })}
          </p>
        )}
        {showTickets && data !== undefined && ticketsQuery.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t("kanban.ticketsError", { message: ticketsQuery.error })}
          </p>
        )}
        {isTruncated && (
          <p className="text-sm text-muted-foreground">
            {t("kanban.truncated")}
          </p>
        )}
        {areTicketsTruncated && (
          <p className="text-sm text-muted-foreground">
            {t("kanban.ticketsTruncated")}
          </p>
        )}
      </div>

      {renderBoard()}

      <QuickLogDialog
        open={quickLog.isOpen}
        target={quickLog.target}
        onOpenChange={(open) => !open && quickLog.close()}
        onLogged={handleLogged}
      />
      <TaskDetailsDialog
        state={taskDetails.state}
        onClose={taskDetails.close}
      />
    </>
  )
}

interface KanbanPageProps {
  onOpenSettings: () => void
}

export function KanbanPage({ onOpenSettings }: KanbanPageProps) {
  return (
    <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <KanbanWorkspace />
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
