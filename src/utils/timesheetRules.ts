import type { OdooTaskMatch, TimesheetEntry } from "@/types/timesheet"

export const MIN_HOURS = 0.25
export const MAX_HOURS = 24
export const HOURS_STEP = 0.25
/** Hours expected on a working day. */
export const WORKDAY_HOURS = 8

export type SubmittableEntry = TimesheetEntry & { task: OdooTaskMatch }

export function isValidHours(hours: number): boolean {
  return Number.isFinite(hours) && hours >= MIN_HOURS && hours <= MAX_HOURS
}

/** The line exists in Odoo: submitted from here, or logged before. */
export function isInOdoo(entry: TimesheetEntry): boolean {
  return entry.status === "submitted" || entry.status === "logged"
}

export function isEditable(entry: TimesheetEntry): boolean {
  return !isInOdoo(entry) && entry.activity === "idle"
}

/**
 * The line can be checked against Odoo: its reference is searched, or the
 * task picked by hand is checked for time already logged.
 */
export function canVerify(entry: TimesheetEntry): boolean {
  return (
    isEditable(entry) &&
    (entry.commit.taskRef !== null ||
      (entry.isTaskManual && entry.task !== null))
  )
}

/** A task can be picked by hand for any line that isn't in Odoo yet. */
export function canAssignTask(entry: TimesheetEntry): boolean {
  return isEditable(entry)
}

/**
 * Other lines of the list that share this line's unknown reference and
 * still have no task: the same choice usually applies to them too.
 */
export function findSameReferenceLines(
  entry: TimesheetEntry,
  entries: TimesheetEntry[]
): TimesheetEntry[] {
  const { taskRef } = entry.commit
  if (taskRef === null) {
    return []
  }
  return entries.filter(
    (other) =>
      other.id !== entry.id &&
      other.task === null &&
      other.commit.taskRef === taskRef &&
      canAssignTask(other)
  )
}

export function isSubmittable(
  entry: TimesheetEntry
): entry is SubmittableEntry {
  return (
    entry.task !== null &&
    isEditable(entry) &&
    (entry.status === "found" || entry.status === "error") &&
    isValidHours(entry.hours) &&
    entry.description.trim() !== ""
  )
}

/** Hours expected for the entries: one workday per distinct date. */
export function expectedHours(entries: TimesheetEntry[]): number {
  const days = new Set(entries.map((entry) => entry.date)).size
  return WORKDAY_HOURS * Math.max(1, days)
}

/** Rounds to two decimals to avoid floating point noise in hour totals. */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100
}
