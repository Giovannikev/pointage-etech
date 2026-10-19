import type { LoggedTimesheet, OdooTaskMatch } from "@/types/timesheet"
import { roundHours } from "@/utils/timesheetRules"
import { loggedTimesheetKey, matchKey } from "@/utils/timesheetTarget"

interface ReconciliationTarget {
  id: string
  description: string
  date: string
  task: OdooTaskMatch
}

/** How a line relates to the timesheets already logged in Odoo. */
export interface OdooReconciliation {
  /** Existing timesheet with the same task, date and description. */
  duplicate: LoggedTimesheet | null
  /** Hours already logged on the same task and date. */
  loggedHours: number
}

export const NOT_LOGGED: OdooReconciliation = {
  duplicate: null,
  loggedHours: 0,
}

function dayKey(targetKey: string, date: string): string {
  return `${targetKey}:${date}`
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * Compares lines with the user's existing Odoo timesheets on the same task
 * (or ticket) and day. A timesheet with the same description marks a line as already
 * logged; each timesheet matches one line at most, so two identical commits
 * against one timesheet leave the second line submittable.
 */
export function reconcileWithOdoo(
  targets: ReconciliationTarget[],
  timesheets: LoggedTimesheet[]
): Map<string, OdooReconciliation> {
  const byDay = new Map<string, LoggedTimesheet[]>()
  for (const timesheet of timesheets) {
    const key = dayKey(loggedTimesheetKey(timesheet), timesheet.date)
    byDay.set(key, [...(byDay.get(key) ?? []), timesheet])
  }
  const matched = new Set<LoggedTimesheet>()

  return new Map(
    targets.map((target) => {
      const sameDay =
        byDay.get(dayKey(matchKey(target.task), target.date)) ?? []
      const description = normalizeDescription(target.description)
      const duplicate =
        sameDay.find(
          (timesheet) =>
            !matched.has(timesheet) &&
            normalizeDescription(timesheet.description) === description
        ) ?? null
      if (duplicate !== null) {
        matched.add(duplicate)
      }
      const loggedHours = roundHours(
        sameDay.reduce((sum, timesheet) => sum + timesheet.hours, 0)
      )
      return [target.id, { duplicate, loggedHours }]
    })
  )
}
