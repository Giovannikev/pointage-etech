import { useCallback, useMemo, useState } from "react"
import {
  LifeBuoyIcon,
  ListTodoIcon,
  Loader2Icon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { KanbanCard } from "@/components/kanban/KanbanCard"
import {
  QuickLogDialog,
  type QuickLogResult,
} from "@/components/kanban/QuickLogDialog"
import { SettingsGate } from "@/components/settings/SettingsGate"
import { TicketCard } from "@/components/tasks/TicketCard"
import { InstanceErrorNotice } from "@/components/timesheet/InstanceErrorNotice"
import {
  InstanceFilter,
  type InstanceFilterValue,
} from "@/components/timesheet/InstanceFilter"
import {
  taskTarget,
  ticketTarget,
  type LogTarget,
} from "@/components/timesheet/logTarget"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { useTaskDetails } from "@/hooks/useTaskDetails"
import { useSyncViewParams } from "@/hooks/useViewParams"
import {
  peekTaskSearch,
  peekTickets,
  searchAllTasks,
  searchTickets,
} from "@/services/odooService"
import type {
  InstanceResult,
  KanbanTask,
  OdooTaskMatch,
  TaskSearchInstanceResult,
  TicketsInstanceResult,
} from "@/types/timesheet"
import { matchesTicketSearch } from "@/utils/kanban"
import {
  formatInstanceParam,
  parseInstanceParam,
  readViewParams,
} from "@/utils/viewParams"

/** Mirrors MIN_QUERY_LENGTH in the odoo-gateway Edge Function. */
const MIN_QUERY_LENGTH = 2

type Tab = "tasks" | "tickets"

function readInitialFilters() {
  const params = readViewParams()
  return {
    tab: (params.get("tab") === "tickets" ? "tickets" : "tasks") as Tab,
    query: params.get("q") ?? "",
    instance: parseInstanceParam(params.get("instance")),
    mine: params.get("scope") !== "all",
  }
}

function failuresOf<T>(
  results: InstanceResult<T>[] | undefined
): Extract<InstanceResult<T>, { ok: false }>[] {
  return (results ?? []).filter(
    (result): result is Extract<InstanceResult<T>, { ok: false }> => !result.ok
  )
}

function toTaskMatch(task: KanbanTask): OdooTaskMatch {
  return {
    taskId: task.taskId,
    taskName: task.name,
    projectId: task.projectId ?? 0,
    projectName: task.projectName ?? "",
    instanceIndex: task.instanceIndex,
  }
}

function ResultsSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={t("common.loading")}
    >
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="h-32 rounded-lg" />
      ))}
    </div>
  )
}

function SearchHint({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon />
        </EmptyMedia>
        <EmptyTitle>
          {tab === "tasks"
            ? t("tasks.searchTasksTitle")
            : t("tasks.searchTicketsTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {tab === "tasks"
            ? t("tasks.searchTasksHint")
            : t("tasks.searchTicketsHint")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LoadError({
  message,
  onRetry,
  isRetrying,
}: {
  message: string | null
  onRetry: () => void
  isRetrying: boolean
}) {
  const { t } = useTranslation()
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{t("tasks.loadError")}</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry} disabled={isRetrying}>
          {t("common.tryAgain")}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function NoResults({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {tab === "tasks" ? <ListTodoIcon /> : <LifeBuoyIcon />}
        </EmptyMedia>
        <EmptyTitle>{t("tasks.noResults")}</EmptyTitle>
        <EmptyDescription>{t("tasks.noResultsHint")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

interface ResultsProps {
  instance: InstanceFilterValue
  showInstance: boolean
  onLogTime: (target: LogTarget) => void
}

/** Any task of the instances, assigned or not, matching the query. */
function TaskResults({
  query,
  instance,
  showInstance,
  onLogTime,
}: ResultsProps & { query: string }) {
  const { t } = useTranslation()
  const taskDetails = useTaskDetails()
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => searchAllTasks(query, { force }),
    [query]
  )
  const peek = useCallback(() => peekTaskSearch(query), [query])
  const search = useCachedQuery<TaskSearchInstanceResult[]>(
    `taskSearch:${query}`,
    fetcher,
    peek
  )

  if (search.isLoading) return <ResultsSkeleton />
  if (search.data === undefined) {
    return (
      <LoadError
        message={search.error}
        onRetry={search.refresh}
        isRetrying={search.isRefreshing}
      />
    )
  }

  const tasks = search.data.flatMap((result) =>
    result.ok && (instance === "all" || result.instanceIndex === instance)
      ? result.tasks
      : []
  )
  const truncated = search.data.some((result) => result.ok && result.truncated)

  return (
    <>
      {failuresOf(search.data).map((failure) => (
        <InstanceErrorNotice
          key={failure.instanceIndex}
          instanceIndex={failure.instanceIndex}
          message={failure.error}
        />
      ))}
      {truncated && (
        <p className="text-sm text-muted-foreground">{t("tasks.truncated")}</p>
      )}
      {tasks.length === 0 ? (
        <NoResults tab="tasks" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((task) => (
            <li key={`${task.instanceIndex}:${task.taskId}`}>
              <KanbanCard
                task={task}
                showInstance={showInstance}
                context="project"
                onOpenTask={(item) => taskDetails.open(toTaskMatch(item))}
                onLogTime={(item) => onLogTime(taskTarget(item))}
              />
            </li>
          ))}
        </ul>
      )}
      <TaskDetailsDialog
        state={taskDetails.state}
        onClose={taskDetails.close}
      />
    </>
  )
}

/**
 * The user's open tickets (filtered here by the query), or every open
 * ticket matching the query (searched in Odoo).
 */
function TicketResults({
  query,
  mine,
  instance,
  showInstance,
  onLogTime,
}: ResultsProps & { query: string; mine: boolean }) {
  const { t } = useTranslation()
  // Mine: one request, filtered locally. All: one request per query.
  const serverQuery = mine ? "" : query
  const fetcher = useCallback(
    ({ force }: { force: boolean }) =>
      searchTickets(serverQuery, mine, { force }),
    [serverQuery, mine]
  )
  const peek = useCallback(
    () => peekTickets(serverQuery, mine),
    [serverQuery, mine]
  )
  const search = useCachedQuery<TicketsInstanceResult[]>(
    `tickets:${mine ? "mine" : "all"}:${serverQuery}`,
    fetcher,
    peek
  )
  const tickets = useMemo(
    () =>
      (search.data ?? [])
        .flatMap((result) =>
          result.ok && (instance === "all" || result.instanceIndex === instance)
            ? result.tickets
            : []
        )
        .filter((ticket) => !mine || matchesTicketSearch(ticket, query)),
    [search.data, instance, mine, query]
  )

  if (search.isLoading) return <ResultsSkeleton />
  if (search.data === undefined) {
    return (
      <LoadError
        message={search.error}
        onRetry={search.refresh}
        isRetrying={search.isRefreshing}
      />
    )
  }

  const okResults = search.data.filter((result) => result.ok)
  if (okResults.length > 0 && okResults.every((result) => !result.available)) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LifeBuoyIcon />
          </EmptyMedia>
          <EmptyTitle>{t("tasks.helpdeskMissing")}</EmptyTitle>
          <EmptyDescription>{t("tasks.helpdeskMissingHint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const truncated = search.data.some((result) => result.ok && result.truncated)

  return (
    <>
      {failuresOf(search.data).map((failure) => (
        <InstanceErrorNotice
          key={failure.instanceIndex}
          instanceIndex={failure.instanceIndex}
          message={failure.error}
        />
      ))}
      {truncated && (
        <p className="text-sm text-muted-foreground">{t("tasks.truncated")}</p>
      )}
      {tickets.length === 0 ? (
        mine && query.trim() === "" ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LifeBuoyIcon />
              </EmptyMedia>
              <EmptyTitle>{t("tasks.noOpenTickets")}</EmptyTitle>
              <EmptyDescription>
                {t("tasks.noOpenTicketsHint")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <NoResults tab="tickets" />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tickets.map((ticket) => (
            <li key={`${ticket.instanceIndex}:${ticket.ticketId}`}>
              <TicketCard
                ticket={ticket}
                showInstance={showInstance}
                onLogTime={(item) => onLogTime(ticketTarget(item))}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function TasksWorkspace() {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  const instances = useOdooInstances()
  const [initial] = useState(readInitialFilters)
  const [tab, setTab] = useState<Tab>(initial.tab)
  const [query, setQuery] = useState(initial.query)
  const [instance, setInstance] = useState<InstanceFilterValue>(
    initial.instance
  )
  const [mine, setMine] = useState(initial.mine)
  const quickLog = useDialogTarget<LogTarget>()

  // Searches Odoo once the user pauses typing, not on every key.
  const debouncedQuery = useDebouncedValue(query.trim(), 350)
  const isTyping = debouncedQuery !== query.trim()
  const canSearch = debouncedQuery.length >= MIN_QUERY_LENGTH
  const showInstance = instance === "all" && instances.length > 1

  useSyncViewParams("tasks", {
    tab: tab === "tickets" ? "tickets" : null,
    q: query.trim(),
    instance: formatInstanceParam(instance),
    scope: tab === "tickets" && !mine ? "all" : null,
  })

  const handleLogged = ({ target, hours, date }: QuickLogResult): void => {
    quickLog.close()
    toast.success(
      t("quickLog.logged", {
        hours: formatHours(hours),
        date: formatShortDate(date),
      }),
      { description: target.name }
    )
  }

  const results = () => {
    if (tab === "tasks") {
      return canSearch ? (
        <TaskResults
          query={debouncedQuery}
          instance={instance}
          showInstance={showInstance}
          onLogTime={quickLog.open}
        />
      ) : (
        <SearchHint tab="tasks" />
      )
    }
    return mine || canSearch ? (
      <TicketResults
        query={mine ? query : debouncedQuery}
        mine={mine}
        instance={instance}
        showInstance={showInstance}
        onLogTime={quickLog.open}
      />
    ) : (
      <SearchHint tab="tickets" />
    )
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t("tasks.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("tasks.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t("tasks.typeLabel")}
            value={tab}
            onValueChange={(value) => {
              if (value === "tasks" || value === "tickets") {
                setTab(value)
              }
            }}
          >
            <ToggleGroupItem value="tasks">
              <ListTodoIcon />
              {t("tasks.tabTasks")}
            </ToggleGroupItem>
            <ToggleGroupItem value="tickets">
              <LifeBuoyIcon />
              {t("tasks.tabTickets")}
            </ToggleGroupItem>
          </ToggleGroup>
          {tab === "tickets" && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label={t("tasks.scopeLabel")}
              value={mine ? "mine" : "all"}
              onValueChange={(value) => {
                if (value === "mine" || value === "all") {
                  setMine(value === "mine")
                }
              }}
            >
              <ToggleGroupItem value="mine">
                {t("tasks.myTickets")}
              </ToggleGroupItem>
              <ToggleGroupItem value="all">
                {t("tasks.allTickets")}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <InstanceFilter value={instance} onChange={setInstance} />
        </div>

        <div className="relative w-full sm:max-w-md">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            autoFocus
            placeholder={
              tab === "tasks"
                ? t("tasks.searchTasksPlaceholder")
                : t("tasks.searchTicketsPlaceholder")
            }
            aria-label={t("tasks.search")}
            className="pr-8 pl-8"
            onChange={(event) => setQuery(event.target.value)}
          />
          {isTyping && (tab === "tasks" || !mine) && (
            <Loader2Icon
              aria-hidden
              className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
        </div>
      </div>

      {results()}

      <QuickLogDialog
        open={quickLog.isOpen}
        target={quickLog.target}
        onOpenChange={(open) => !open && quickLog.close()}
        onLogged={handleLogged}
      />
    </>
  )
}

interface TasksPageProps {
  onOpenSettings: () => void
}

/** Finds any task or helpdesk ticket, assigned or not, and logs time on it. */
export function TasksPage({ onOpenSettings }: TasksPageProps) {
  return (
    <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <TasksWorkspace />
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
