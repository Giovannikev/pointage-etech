import type {
  CommitPeriod,
  OdooTaskMatch,
  ParsedCommit,
  SubmissionResult,
  TimesheetEntry,
} from "@/types/timesheet"
import { estimateHours, type EstimateLine } from "@/utils/hoursEstimate"
import type { OdooReconciliation } from "@/utils/odooReconciliation"
import { isInPeriod } from "@/utils/period"
import { describeCommit } from "@/utils/timesheetDescription"
import {
  canAssignTask,
  isEditable,
  isInOdoo,
  roundHours,
} from "@/utils/timesheetRules"
import { resolveSubmission } from "@/utils/timesheetSubmission"

/*
 * The timesheet lines being prepared and how each action changes them; pure,
 * so useTimesheet's state is tested without React.
 */

const DEFAULT_HOURS = 1

export interface DatedCommit {
  commit: ParsedCommit
  date: string
  authoredAt: string | null
}

export interface TaskResolution {
  id: string
  task: OdooTaskMatch | null
  description: string
  reconciliation: OdooReconciliation
}

export type TimesheetAction =
  | { type: "entriesAdded"; entries: TimesheetEntry[] }
  | { type: "entryRemoved"; id: string }
  | { type: "periodApplied"; period: CommitPeriod }
  | { type: "descriptionChanged"; id: string; description: string }
  | { type: "hoursChanged"; id: string; hours: number }
  | { type: "verificationStarted"; ids: string[] }
  | { type: "verificationResolved"; resolutions: TaskResolution[] }
  | { type: "verificationFailed"; ids: string[]; message: string }
  /** The user picked the task of these lines by hand. */
  | { type: "taskAssigned"; ids: string[]; task: OdooTaskMatch }
  | { type: "submissionStarted"; ids: string[] }
  | { type: "submissionResolved"; ids: string[]; results: SubmissionResult[] }
  | { type: "submissionFailed"; ids: string[]; message: string }
  | {
      type: "loggedEntryUpdated"
      id: string
      hours: number
      description: string
    }
  | { type: "loggedEntryDeleted"; id: string }
  /** Spreads the workday over the lines of these days (all days when null). */
  | { type: "hoursEstimated"; dates: string[] | null }

function updateWhere(
  entries: TimesheetEntry[],
  ids: ReadonlySet<string>,
  update: (entry: TimesheetEntry) => TimesheetEntry
): TimesheetEntry[] {
  return entries.map((entry) => (ids.has(entry.id) ? update(entry) : entry))
}

/** Editing a line that failed to submit puts it back in the "found" state. */
function applyEdit(
  entry: TimesheetEntry,
  patch: Partial<
    Pick<
      TimesheetEntry,
      "description" | "isDescriptionEdited" | "hours" | "isHoursEdited"
    >
  >
): TimesheetEntry {
  if (!isEditable(entry)) {
    return entry
  }
  const recovered =
    entry.status === "error" && entry.task !== null
      ? { status: "found" as const, statusDetail: null }
      : {}
  return { ...entry, ...patch, ...recovered }
}

/**
 * Attaches a task picked by hand. The description is rebuilt with the task's
 * title unless the user typed it; the check against Odoo follows.
 */
export function withManualTask(
  entry: TimesheetEntry,
  task: OdooTaskMatch
): TimesheetEntry {
  if (!canAssignTask(entry)) {
    return entry
  }
  return {
    ...entry,
    task,
    isTaskManual: true,
    status: "found",
    statusDetail: null,
    loggedHours: 0,
    description: entry.isDescriptionEdited
      ? entry.description
      : describeCommit(entry.commit, task),
  }
}

function resolveVerification(
  entry: TimesheetEntry,
  { task, description, reconciliation }: TaskResolution
): TimesheetEntry {
  const base = { ...entry, activity: "idle" as const, task, description }
  if (task === null) {
    return {
      ...base,
      status: "missing",
      statusDetail: {
        reason: "taskNotFound",
        taskRef: entry.commit.taskRef ?? "",
      },
      loggedHours: 0,
    }
  }
  const { duplicate, loggedHours } = reconciliation
  if (duplicate !== null) {
    // Mirror the existing timesheet so the hours reflect what Odoo holds.
    return {
      ...base,
      status: "logged",
      statusDetail: { reason: "alreadyLogged" },
      hours: duplicate.hours,
      odooTimesheetId: duplicate.timesheetId,
      odooLocked: duplicate.locked,
      loggedHours,
    }
  }
  return { ...base, status: "found", statusDetail: null, loggedHours }
}

/** Mirrors an edit made in Odoo on a line that is already there. */
function applyOdooUpdate(
  entry: TimesheetEntry,
  hours: number,
  description: string
): TimesheetEntry {
  // loggedHours counts the duplicate itself for lines found already logged.
  const loggedHours =
    entry.status === "logged"
      ? roundHours(Math.max(0, entry.loggedHours - entry.hours + hours))
      : entry.loggedHours
  return {
    ...entry,
    hours,
    description,
    isDescriptionEdited: true,
    loggedHours,
  }
}

/** The line left Odoo: it is back to a found line, ready to submit again. */
function applyOdooDeletion(entry: TimesheetEntry): TimesheetEntry {
  const loggedHours =
    entry.status === "logged"
      ? roundHours(Math.max(0, entry.loggedHours - entry.hours))
      : entry.loggedHours
  return {
    ...entry,
    status: "found",
    statusDetail: null,
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours,
  }
}

/**
 * How a line takes part in the estimate: fixed (in Odoo, or hours typed by
 * the user), flexible (a line to submit), or left out (no task: it won't be
 * submitted, so it shouldn't take a share of the day).
 */
export function toEstimateLine(entry: TimesheetEntry): EstimateLine | null {
  if (entry.task === null) {
    return null
  }
  const isFixed = isInOdoo(entry) || entry.isHoursEdited || !isEditable(entry)
  return {
    id: entry.id,
    date: entry.date,
    authoredAt: entry.authoredAt,
    hours: entry.hours,
    isFixed,
  }
}

function applyEstimate(
  entries: TimesheetEntry[],
  dates: string[] | null
): TimesheetEntry[] {
  const wanted = dates === null ? null : new Set(dates)
  const lines = entries
    .filter((entry) => wanted === null || wanted.has(entry.date))
    .flatMap((entry) => toEstimateLine(entry) ?? [])
  const estimates = estimateHours(lines)
  return entries.map((entry) => {
    const hours = estimates.get(entry.id)
    return hours === undefined || hours === entry.hours
      ? entry
      : { ...entry, hours }
  })
}

/** Same commit message on the same day: the same line. */
function entryKey(entry: TimesheetEntry): string {
  return `${entry.date}\u0000${entry.commit.rawMessage}`
}

/**
 * Appends the lines whose commit isn't in the list yet, checked against the
 * list as it is when the action runs: two imports overlapping (a paste
 * during a GitHub fetch) can't add the same commit twice.
 */
function addEntries(
  entries: TimesheetEntry[],
  candidates: TimesheetEntry[]
): TimesheetEntry[] {
  const known = new Set(entries.map(entryKey))
  const fresh = candidates.filter((candidate) => {
    const key = entryKey(candidate)
    if (known.has(key)) {
      return false
    }
    known.add(key)
    return true
  })
  return fresh.length === 0 ? entries : [...entries, ...fresh]
}

export function timesheetReducer(
  entries: TimesheetEntry[],
  action: TimesheetAction
): TimesheetEntry[] {
  switch (action.type) {
    case "entriesAdded":
      return addEntries(entries, action.entries)

    case "entryRemoved":
      return entries.filter(
        (entry) => entry.id !== action.id || entry.activity !== "idle"
      )

    case "periodApplied":
      // Lines of other days leave the list; those being sent stay until done.
      return entries.filter(
        (entry) =>
          isInPeriod(entry.date, action.period) || entry.activity !== "idle"
      )

    case "descriptionChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, {
          description: action.description,
          isDescriptionEdited: true,
        })
      )

    case "hoursChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, { hours: action.hours, isHoursEdited: true })
      )

    case "verificationStarted":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "verifying",
        status: "pending",
        statusDetail: null,
      }))

    case "verificationResolved": {
      const byId = new Map(
        action.resolutions.map((resolution) => [resolution.id, resolution])
      )
      return entries.map((entry) => {
        const resolution = byId.get(entry.id)
        return resolution === undefined
          ? entry
          : resolveVerification(entry, resolution)
      })
    }

    case "verificationFailed":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "idle",
        // A task picked by hand stays: only the check against Odoo failed.
        task: entry.isTaskManual ? entry.task : null,
        status: "error",
        statusDetail: { reason: "serverError", message: action.message },
        loggedHours: 0,
      }))

    case "taskAssigned":
      return updateWhere(entries, new Set(action.ids), (entry) =>
        withManualTask(entry, action.task)
      )

    case "submissionStarted":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "submitting",
      }))

    case "submissionResolved": {
      const byClientId = new Map(
        action.results.map((result) => [result.clientId, result])
      )
      return updateWhere(entries, new Set(action.ids), (entry) =>
        resolveSubmission(entry, byClientId.get(entry.id))
      )
    }

    case "submissionFailed":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "idle",
        status: "error",
        statusDetail: { reason: "serverError", message: action.message },
      }))

    case "loggedEntryUpdated":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        isInOdoo(entry)
          ? applyOdooUpdate(entry, action.hours, action.description)
          : entry
      )

    case "loggedEntryDeleted":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        isInOdoo(entry) ? applyOdooDeletion(entry) : entry
      )

    case "hoursEstimated":
      return applyEstimate(entries, action.dates)
  }
}

/** A new line for a commit, waiting for its task to be searched. */
export function createEntry({
  commit,
  date,
  authoredAt,
}: DatedCommit): TimesheetEntry {
  const hasTaskRef = commit.taskRef !== null
  return {
    id: crypto.randomUUID(),
    commit,
    description: describeCommit(commit, null),
    isDescriptionEdited: false,
    hours: DEFAULT_HOURS,
    isHoursEdited: false,
    date,
    authoredAt,
    status: hasTaskRef ? "pending" : "missing",
    task: null,
    isTaskManual: false,
    activity: "idle",
    statusDetail: hasTaskRef ? null : { reason: "noTaskReference" },
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours: 0,
  }
}
