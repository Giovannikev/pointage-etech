import type { TimesheetEntry, TimesheetStatus } from "@/types/timesheet"
import { isRecord } from "@/utils/guards"

/**
 * The timesheet lines being prepared, kept in the browser per user so a
 * reload (new deployment, update button, the phone closing the app) doesn't
 * lose imported commits, edited hours and hand-picked tasks.
 */
const DRAFT_VERSION = 1

const STATUSES: ReadonlySet<TimesheetStatus> = new Set([
  "pending",
  "found",
  "missing",
  "logged",
  "submitted",
  "error",
])

function draftKey(userId: string): string {
  return `pointage:timesheet-draft:${userId}`
}

function isStoredEntry(value: unknown): value is TimesheetEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.commit) &&
    typeof value.description === "string" &&
    typeof value.hours === "number" &&
    typeof value.date === "string" &&
    STATUSES.has(value.status as TimesheetStatus)
  )
}

/**
 * Work interrupted by the reload is settled: a check simply stops, and a
 * line that was being sent may or may not be in Odoo. It goes back to
 * "error", and sending it again is safe: the gateway finds the line Odoo
 * already created instead of logging it twice.
 */
export function settleInterrupted(entry: TimesheetEntry): TimesheetEntry {
  if (entry.activity === "submitting") {
    return {
      ...entry,
      activity: "idle",
      status: "error",
      statusDetail: { reason: "noOdooResult" },
    }
  }
  return entry.activity === "idle" ? entry : { ...entry, activity: "idle" }
}

/** The lines saved for this user, or none when absent or unreadable. */
export function loadTimesheetDraft(userId: string): TimesheetEntry[] {
  try {
    const raw = localStorage.getItem(draftKey(userId))
    if (raw === null) {
      return []
    }
    const draft: unknown = JSON.parse(raw)
    if (
      !isRecord(draft) ||
      draft.version !== DRAFT_VERSION ||
      !Array.isArray(draft.entries)
    ) {
      return []
    }
    return draft.entries.filter(isStoredEntry).map(settleInterrupted)
  } catch {
    // Storage blocked or a corrupt draft: start empty.
    return []
  }
}

export function saveTimesheetDraft(
  userId: string,
  entries: TimesheetEntry[]
): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(draftKey(userId))
      return
    }
    localStorage.setItem(
      draftKey(userId),
      JSON.stringify({ version: DRAFT_VERSION, entries })
    )
  } catch {
    // Storage full or blocked: the lines still live in memory.
  }
}
