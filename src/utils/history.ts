import type {
  CommitPeriod,
  OdooInstanceIndex,
  TimesheetHistoryEntry,
  TimesheetHistoryInstanceResult,
} from "@/types/timesheet"
import { addDays, countDays, startOfDay } from "@/utils/date"
import { normalizeText } from "@/utils/kanban"
import { roundHours, WORKDAY_HOURS } from "@/utils/timesheetRules"

/** Longest stretch of days drawn one by one in the daily chart. */
const MAX_CHART_DAYS = 62

export interface HistoryFilters {
  instance: "all" | OdooInstanceIndex
  query: string
}

function matchesQuery(entry: TimesheetHistoryEntry, words: string[]): boolean {
  if (words.length === 0) {
    return true
  }
  const haystack = normalizeText(
    [entry.description, entry.taskName ?? "", entry.projectName ?? ""].join(" ")
  )
  return words.every((word) => haystack.includes(word))
}

/** The lines of the successful instances that pass the filters, newest first. */
export function filterHistory(
  results: TimesheetHistoryInstanceResult[],
  { instance, query }: HistoryFilters
): TimesheetHistoryEntry[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  return results
    .flatMap((result) =>
      result.ok && (instance === "all" || result.instanceIndex === instance)
        ? result.entries
        : []
    )
    .filter((entry) => matchesQuery(entry, words))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.instanceIndex - b.instanceIndex ||
        b.timesheetId - a.timesheetId
    )
}

export interface HistoryDay {
  /** YYYY-MM-DD */
  date: string
  hours: number
  entries: TimesheetHistoryEntry[]
}

/** Entries grouped by day, in the order they come (newest first after filterHistory). */
export function groupByDay(entries: TimesheetHistoryEntry[]): HistoryDay[] {
  const days = new Map<string, TimesheetHistoryEntry[]>()
  for (const entry of entries) {
    days.set(entry.date, [...(days.get(entry.date) ?? []), entry])
  }
  return [...days.entries()].map(([date, dayEntries]) => ({
    date,
    entries: dayEntries,
    hours: roundHours(dayEntries.reduce((sum, entry) => sum + entry.hours, 0)),
  }))
}

export interface HistorySummary {
  totalHours: number
  /** Days with at least one line. */
  loggedDays: number
  /** Total hours divided by logged days; 0 without any day. */
  averagePerDay: number
  /** Logged days reaching the workday target. */
  fullDays: number
  /** Logged days below the workday target. */
  shortDays: number
  target: number
}

export function summarizeHistory(days: HistoryDay[]): HistorySummary {
  const totalHours = roundHours(days.reduce((sum, day) => sum + day.hours, 0))
  const fullDays = days.filter((day) => day.hours >= WORKDAY_HOURS).length
  return {
    totalHours,
    loggedDays: days.length,
    averagePerDay: days.length === 0 ? 0 : roundHours(totalHours / days.length),
    fullDays,
    shortDays: days.length - fullDays,
    target: WORKDAY_HOURS,
  }
}

function isWeekend(isoDate: string): boolean {
  const day = startOfDay(isoDate).getDay()
  return day === 0 || day === 6
}

export interface ChartDay {
  date: string
  hours: number
}

/**
 * Days drawn in the daily chart, oldest first: every weekday of the period up
 * to today (an empty weekday is a gap worth seeing), plus worked weekend days.
 * Long periods only keep the days with hours.
 */
export function chartDays(
  days: HistoryDay[],
  period: CommitPeriod,
  today: string
): ChartDay[] {
  const hoursByDate = new Map(days.map((day) => [day.date, day.hours]))
  const last = period.to < today ? period.to : today
  if (last < period.from) {
    return []
  }
  const span = countDays(period.from, last)
  if (span > MAX_CHART_DAYS) {
    return [...hoursByDate.entries()]
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
  return Array.from({ length: span }, (_, offset) => {
    const date = addDays(period.from, offset)
    return { date, hours: hoursByDate.get(date) ?? 0 }
  }).filter((day) => day.hours > 0 || !isWeekend(day.date))
}

/* ------------------------------------------------------------------ */
/* Week grid: tasks as rows, days as columns                           */
/* ------------------------------------------------------------------ */

/** Longest period shown as a grid; longer ones stay in the list view. */
export const MAX_GRID_DAYS = 31

export interface GridRow {
  key: string
  instanceIndex: OdooInstanceIndex
  /** Task name, or project name for lines without a task. */
  label: string
  projectName: string | null
  /** Hours per day (YYYY-MM-DD). */
  hoursByDate: ReadonlyMap<string, number>
  total: number
}

export interface HistoryGrid {
  dates: string[]
  rows: GridRow[]
  totalsByDate: ReadonlyMap<string, number>
  total: number
}

/** null when the period is too long to draw one column per day. */
export function buildHistoryGrid(
  entries: TimesheetHistoryEntry[],
  period: CommitPeriod
): HistoryGrid | null {
  const span = countDays(period.from, period.to)
  if (span < 1 || span > MAX_GRID_DAYS) {
    return null
  }
  const dates = Array.from({ length: span }, (_, offset) =>
    addDays(period.from, offset)
  )
  const rows = new Map<
    string,
    Omit<GridRow, "hoursByDate" | "total"> & { hours: Map<string, number> }
  >()
  const totals = new Map<string, number>()

  for (const entry of entries) {
    const key =
      entry.taskId === null
        ? `${entry.instanceIndex}:project:${entry.projectId ?? 0}`
        : `${entry.instanceIndex}:task:${entry.taskId}`
    let row = rows.get(key)
    if (row === undefined) {
      row = {
        key,
        instanceIndex: entry.instanceIndex,
        label: entry.taskName ?? entry.projectName ?? "—",
        projectName: entry.taskName === null ? null : entry.projectName,
        hours: new Map(),
      }
      rows.set(key, row)
    }
    row.hours.set(entry.date, (row.hours.get(entry.date) ?? 0) + entry.hours)
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + entry.hours)
  }

  const gridRows = [...rows.values()]
    .map(({ hours, ...row }) => {
      const hoursByDate = new Map(
        [...hours].map(([date, value]) => [date, roundHours(value)])
      )
      return {
        ...row,
        hoursByDate,
        total: roundHours([...hours.values()].reduce((a, b) => a + b, 0)),
      }
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))

  return {
    dates,
    rows: gridRows,
    totalsByDate: new Map(
      [...totals].map(([date, value]) => [date, roundHours(value)])
    ),
    total: roundHours([...totals.values()].reduce((a, b) => a + b, 0)),
  }
}

/* ------------------------------------------------------------------ */
/* Tasks to complete a day with                                        */
/* ------------------------------------------------------------------ */

export interface LoggableTask {
  instanceIndex: OdooInstanceIndex
  taskId: number
  projectId: number
  name: string
  projectName: string | null
  /** Already used in the loaded history: listed first. */
  isRecent: boolean
}

/**
 * Tasks time can be logged on: the ones of the loaded history (most recent
 * first), then the other tasks assigned to the user.
 */
export function listLoggableTasks(
  entries: TimesheetHistoryEntry[],
  assigned: readonly {
    instanceIndex: OdooInstanceIndex
    taskId: number
    projectId: number | null
    name: string
    projectName: string | null
  }[]
): LoggableTask[] {
  const tasks = new Map<string, LoggableTask>()
  const byRecency = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  for (const entry of byRecency) {
    if (entry.taskId === null || entry.projectId === null) continue
    const key = `${entry.instanceIndex}:${entry.taskId}`
    if (!tasks.has(key)) {
      tasks.set(key, {
        instanceIndex: entry.instanceIndex,
        taskId: entry.taskId,
        projectId: entry.projectId,
        name: entry.taskName ?? "",
        projectName: entry.projectName,
        isRecent: true,
      })
    }
  }
  const others = assigned
    .filter(
      (task) =>
        task.projectId !== null &&
        !tasks.has(`${task.instanceIndex}:${task.taskId}`)
    )
    .map((task) => ({
      instanceIndex: task.instanceIndex,
      taskId: task.taskId,
      projectId: task.projectId ?? 0,
      name: task.name,
      projectName: task.projectName,
      isRecent: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...tasks.values(), ...others]
}

/* ------------------------------------------------------------------ */
/* Day load, checked before logging time                               */
/* ------------------------------------------------------------------ */

/** Above this many hours a day, logging more time asks for a second look. */
export const DAY_HOURS_WARNING = 10

export interface DayLoadTarget {
  instanceIndex: OdooInstanceIndex
  taskId: number
  hours: number
  description: string
}

export interface DayLoad {
  /** Hours already logged that day, every instance and task. */
  dayHours: number
  /** Hours already logged that day on the target task. */
  taskHours: number
  /** The day's total once the new line is logged. */
  totalAfter: number
  limit: number
  exceedsLimit: boolean
  /** A line with the same task and description already exists that day. */
  hasDuplicate: boolean
}

export function analyzeDayLoad(
  results: TimesheetHistoryInstanceResult[],
  target: DayLoadTarget
): DayLoad {
  const entries = results.flatMap((result) => (result.ok ? result.entries : []))
  const onTask = entries.filter(
    (entry) =>
      entry.instanceIndex === target.instanceIndex &&
      entry.taskId === target.taskId
  )
  const description = normalizeText(target.description).replace(/\s+/g, " ")
  const dayHours = roundHours(entries.reduce((sum, e) => sum + e.hours, 0))
  const totalAfter = roundHours(dayHours + target.hours)
  return {
    dayHours,
    taskHours: roundHours(onTask.reduce((sum, e) => sum + e.hours, 0)),
    totalAfter,
    limit: DAY_HOURS_WARNING,
    exceedsLimit: totalAfter > DAY_HOURS_WARNING,
    hasDuplicate:
      description !== "" &&
      onTask.some(
        (entry) =>
          normalizeText(entry.description).replace(/\s+/g, " ") === description
      ),
  }
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export interface CsvOptions {
  /** ";" for French spreadsheets, "," otherwise. */
  separator: string
  /** "," for French spreadsheets, "." otherwise. */
  decimalSeparator: string
  headers: readonly string[]
  instanceLabel: (index: OdooInstanceIndex) => string
}

/** Leading characters that make spreadsheets run a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(value: string, separator: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /["\r\n]/.test(safe) || safe.includes(separator)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe
}

/** One line per timesheet: date, instance, project, task, description, hours. */
export function historyToCsv(
  entries: TimesheetHistoryEntry[],
  { separator, decimalSeparator, headers, instanceLabel }: CsvOptions
): string {
  const rows = entries.map((entry) => [
    escapeCell(entry.date, separator),
    escapeCell(instanceLabel(entry.instanceIndex), separator),
    escapeCell(entry.projectName ?? "", separator),
    escapeCell(entry.taskName ?? "", separator),
    escapeCell(entry.description, separator),
    // Numbers aren't escaped, so the spreadsheet reads them as numbers.
    String(entry.hours).replace(".", decimalSeparator),
  ])
  const header = headers.map((cell) => escapeCell(cell, separator))
  return [header, ...rows].map((row) => row.join(separator)).join("\r\n")
}

/** Saves text as a file through a temporary link. */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType: string
): void {
  // The BOM makes Excel read the file as UTF-8 (accents stay intact).
  const blob = new Blob(["\uFEFF", content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked later: some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
