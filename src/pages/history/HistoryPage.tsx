import { useCallback, useMemo, useState } from "react"
import {
  FileDownIcon,
  HistoryIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  CompleteDayDialog,
  type DayToComplete,
} from "@/components/history/CompleteDayDialog"
import { HistorySummaryPanel } from "@/components/history/HistorySummaryPanel"
import { HistoryTable } from "@/components/history/HistoryTable"
import { HistoryWeekGrid } from "@/components/history/HistoryWeekGrid"
import { SettingsGate } from "@/components/settings/SettingsGate"
import { CommitPeriodPicker } from "@/components/timesheet/CommitPeriodPicker"
import { DeleteTimesheetDialog } from "@/components/timesheet/DeleteTimesheetDialog"
import type { EditableTimesheet } from "@/components/timesheet/editableTimesheet"
import { EditTimesheetDialog } from "@/components/timesheet/EditTimesheetDialog"
import { InstanceErrorNotice } from "@/components/timesheet/InstanceErrorNotice"
import {
  InstanceFilter,
  type InstanceFilterValue,
} from "@/components/timesheet/InstanceFilter"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { useSyncViewParams } from "@/hooks/useViewParams"
import { cn } from "@/lib/utils"
import {
  deleteTimesheet,
  fetchTimesheetHistory,
  peekTimesheetHistory,
  updateTimesheet,
} from "@/services/odooService"
import type {
  CommitPeriod,
  TimesheetChanges,
  TimesheetHistoryEntry,
  TimesheetHistoryInstanceResult,
  TimesheetReference,
} from "@/types/timesheet"
import { isIsoDate, todayIsoDate } from "@/utils/date"
import {
  buildHistoryGrid,
  chartDays,
  MAX_GRID_DAYS,
  downloadTextFile,
  filterHistory,
  groupByDay,
  historyToCsv,
  summarizeHistory,
  type HistoryDay,
} from "@/utils/history"
import { getPresetPeriod, isValidPeriod } from "@/utils/period"
import { getInstanceLabel } from "@/utils/settings"
import { roundHours, WORKDAY_HOURS } from "@/utils/timesheetRules"
import {
  formatInstanceParam,
  parseInstanceParam,
  readViewParams,
} from "@/utils/viewParams"

type HistoryView = "list" | "grid"

/** The history's filters as found in the URL when the page opens. */
function readInitialFilters() {
  const params = readViewParams()
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  const urlPeriod = { from, to }
  return {
    period:
      isIsoDate(from) && isIsoDate(to) && isValidPeriod(urlPeriod)
        ? urlPeriod
        : getPresetPeriod("thisWeek"),
    instance: parseInstanceParam(params.get("instance")),
    query: params.get("q") ?? "",
    view: (params.get("view") === "grid" ? "grid" : "list") as HistoryView,
  }
}

type HistoryResults = TimesheetHistoryInstanceResult[]

function toEditable(entry: TimesheetHistoryEntry): EditableTimesheet {
  return {
    instanceIndex: entry.instanceIndex,
    timesheetId: entry.timesheetId,
    date: entry.date,
    hours: entry.hours,
    description: entry.description,
    label: entry.taskName ?? entry.projectName ?? entry.description,
  }
}

function isSameLine(
  entry: TimesheetHistoryEntry,
  reference: TimesheetReference
): boolean {
  return (
    entry.instanceIndex === reference.instanceIndex &&
    entry.timesheetId === reference.timesheetId
  )
}

/** Applies a change to the entries of the reference's instance, immutably. */
function updateEntries(
  results: HistoryResults,
  reference: TimesheetReference,
  update: (entries: TimesheetHistoryEntry[]) => TimesheetHistoryEntry[]
): HistoryResults {
  return results.map((result) =>
    result.ok && result.instanceIndex === reference.instanceIndex
      ? { ...result, entries: update(result.entries) }
      : result
  )
}

function HistorySkeleton() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4" aria-label={t("common.loading")}>
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

interface HistoryResultsViewProps {
  period: CommitPeriod
  instance: InstanceFilterValue
  query: string
  view: HistoryView
  onViewChange: (view: HistoryView) => void
  onClearFilters: () => void
}

/** Everything that depends on the loaded timesheets of a valid period. */
function HistoryResultsView({
  period,
  instance,
  query,
  view,
  onViewChange,
  onClearFilters,
}: HistoryResultsViewProps) {
  const { t } = useTranslation()
  const { language, formatHours, formatShortDate } = useFormatters()
  const instances = useOdooInstances()
  const editDialog = useDialogTarget<EditableTimesheet>()
  const deleteDialog = useDialogTarget<EditableTimesheet>()
  const completeDialog = useDialogTarget<DayToComplete>()

  const { from, to } = period
  const queryKey = `history:${from}:${to}`
  const fetcher = useCallback(
    ({ force }: { force: boolean }) =>
      fetchTimesheetHistory({ from, to }, { force }),
    [from, to]
  )
  const peek = useCallback(() => peekTimesheetHistory({ from, to }), [from, to])
  const history = useCachedQuery<HistoryResults>(queryKey, fetcher, peek)
  const { data, mutate, refresh } = history

  const entries = useMemo(
    () => (data === undefined ? [] : filterHistory(data, { instance, query })),
    [data, instance, query]
  )
  const days = useMemo(() => groupByDay(entries), [entries])
  const summary = useMemo(() => summarizeHistory(days), [days])
  const chart = useMemo(
    () => chartDays(days, { from, to }, todayIsoDate()),
    [days, from, to]
  )
  const grid = useMemo(
    () => (view === "grid" ? buildHistoryGrid(entries, { from, to }) : null),
    [view, entries, from, to]
  )
  /** Every loaded line, whatever the filters: the tasks to complete a day with. */
  const allEntries = useMemo(
    () => filterHistory(data ?? [], { instance: "all", query: "" }),
    [data]
  )
  const failures = (data ?? []).filter(
    (result): result is Extract<typeof result, { ok: false }> => !result.ok
  )
  const isTruncated = (data ?? []).some(
    (result) => result.ok && result.truncated
  )
  const hasAnyEntry = (data ?? []).some(
    (result) => result.ok && result.entries.length > 0
  )

  const handleSave = async (
    timesheet: EditableTimesheet,
    changes: TimesheetChanges
  ): Promise<void> => {
    const saved = await updateTimesheet(timesheet, changes)
    mutate((results) =>
      updateEntries(results, timesheet, (current) =>
        current.map((entry) => (isSameLine(entry, timesheet) ? saved : entry))
      )
    )
    editDialog.close()
    toast.success(t("editTimesheet.saved"), {
      description: `${formatShortDate(saved.date)}: ${formatHours(saved.hours)}`,
    })
  }

  const handleDelete = async (timesheet: EditableTimesheet): Promise<void> => {
    await deleteTimesheet(timesheet)
    mutate((results) =>
      updateEntries(results, timesheet, (current) =>
        current.filter((entry) => !isSameLine(entry, timesheet))
      )
    )
    deleteDialog.close()
    toast.success(t("deleteTimesheet.deleted"), {
      description: `${formatShortDate(timesheet.date)}: ${formatHours(timesheet.hours)}`,
    })
  }

  const openCompleteDay = (day: HistoryDay): void => {
    completeDialog.open({
      date: day.date,
      missingHours: roundHours(Math.max(0.25, WORKDAY_HOURS - day.hours)),
    })
  }

  const handleDayCompleted = (day: DayToComplete, hours: number): void => {
    completeDialog.close()
    toast.success(
      t("completeDay.logged", {
        hours: formatHours(hours),
        date: formatShortDate(day.date),
      })
    )
    // The new line is only in Odoo: read the period again.
    refresh()
  }

  const handleExport = (): void => {
    const isFrench = language === "fr"
    const csv = historyToCsv(entries, {
      separator: isFrench ? ";" : ",",
      decimalSeparator: isFrench ? "," : ".",
      headers: [
        t("timesheet.columns.date"),
        t("timesheet.columns.instance"),
        t("timesheet.columns.project"),
        t("timesheet.columns.task"),
        t("timesheet.columns.description"),
        t("timesheet.columns.hours"),
      ],
      instanceLabel: (index) => getInstanceLabel(instances, index),
    })
    downloadTextFile(
      csv,
      `pointage_${from}_${to}.csv`,
      "text/csv;charset=utf-8"
    )
    toast.success(t("history.exported", { count: entries.length }))
  }

  if (history.isLoading) {
    return <HistorySkeleton />
  }

  if (data === undefined) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("history.loadError")}</EmptyTitle>
          <EmptyDescription>{history.error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={history.isRefreshing}
          >
            {t("common.tryAgain")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("history.lineCount", { count: entries.length })}
        </p>
        <div className="flex flex-wrap gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t("history.view.label")}
            value={view}
            onValueChange={(value) => {
              if (value === "list" || value === "grid") {
                onViewChange(value)
              }
            }}
          >
            <ToggleGroupItem value="list">
              {t("history.view.list")}
            </ToggleGroupItem>
            <ToggleGroupItem value="grid">
              {t("history.view.grid")}
            </ToggleGroupItem>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("history.refresh")}
                onClick={refresh}
                disabled={history.isRefreshing}
              >
                <RefreshCwIcon
                  className={cn(history.isRefreshing && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("history.refresh")}</TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={entries.length === 0}
          >
            <FileDownIcon />
            {t("history.exportCsv")}
          </Button>
        </div>
      </div>

      {failures.map((failure) => (
        <InstanceErrorNotice
          key={failure.instanceIndex}
          instanceIndex={failure.instanceIndex}
          message={failure.error}
        />
      ))}
      {history.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t("history.refreshError", { message: history.error })}
        </p>
      )}
      {isTruncated && (
        <p className="text-sm text-muted-foreground">
          {t("history.truncated")}
        </p>
      )}

      <HistorySummaryPanel summary={summary} chart={chart} />

      {days.length > 0 && view === "grid" ? (
        grid === null ? (
          <p className="text-sm text-muted-foreground">
            {t("history.grid.tooLong", { count: MAX_GRID_DAYS })}
          </p>
        ) : (
          <HistoryWeekGrid grid={grid} />
        )
      ) : days.length > 0 ? (
        <HistoryTable
          days={days}
          onEdit={(entry) => editDialog.open(toEditable(entry))}
          onDelete={(entry) => deleteDialog.open(toEditable(entry))}
          onCompleteDay={openCompleteDay}
        />
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>
              {hasAnyEntry ? t("history.noMatch") : t("history.emptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {hasAnyEntry
                ? t("history.noMatchHint")
                : t("history.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          {hasAnyEntry && (
            <EmptyContent>
              <Button variant="outline" onClick={onClearFilters}>
                {t("common.clearFilters")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      <EditTimesheetDialog
        open={editDialog.isOpen}
        timesheet={editDialog.target}
        onOpenChange={(open) => !open && editDialog.close()}
        onSave={handleSave}
      />
      <DeleteTimesheetDialog
        open={deleteDialog.isOpen}
        timesheet={deleteDialog.target}
        onOpenChange={(open) => !open && deleteDialog.close()}
        onConfirm={handleDelete}
      />
      <CompleteDayDialog
        open={completeDialog.isOpen}
        day={completeDialog.target}
        entries={allEntries}
        onOpenChange={(open) => !open && completeDialog.close()}
        onLogged={handleDayCompleted}
      />
    </>
  )
}

function HistoryWorkspace() {
  const { t } = useTranslation()
  const { formatPeriod } = useFormatters()
  const [initial] = useState(readInitialFilters)
  const [period, setPeriod] = useState<CommitPeriod>(initial.period)
  const [instance, setInstance] = useState<InstanceFilterValue>(
    initial.instance
  )
  const [query, setQuery] = useState(initial.query)
  const [view, setView] = useState<HistoryView>(initial.view)

  useSyncViewParams("history", {
    from: period.from,
    to: period.to,
    instance: formatInstanceParam(instance),
    q: query.trim(),
    view: view === "grid" ? "grid" : null,
  })

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {formatPeriod(period)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("history.subtitle")}
          </p>
        </div>
        <CommitPeriodPicker
          value={period}
          onChange={setPeriod}
          disabled={false}
        />
        <div className="flex flex-wrap items-center gap-3">
          <InstanceFilter value={instance} onChange={setInstance} />
          <div className="relative w-full sm:w-72">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              placeholder={t("history.searchPlaceholder")}
              aria-label={t("history.search")}
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {isValidPeriod(period) && (
        <HistoryResultsView
          period={period}
          instance={instance}
          query={query}
          view={view}
          onViewChange={setView}
          onClearFilters={() => {
            setInstance("all")
            setQuery("")
          }}
        />
      )}
    </>
  )
}

interface HistoryPageProps {
  onOpenSettings: () => void
}

export function HistoryPage({ onOpenSettings }: HistoryPageProps) {
  return (
    <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <HistoryWorkspace />
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
