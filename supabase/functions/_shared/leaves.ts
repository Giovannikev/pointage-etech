import {
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "./odoo.ts"
import { isRecord } from "./validation.ts"

/** Every state of an hr.leave request. */
export type LeaveState =
  "confirm" | "refuse" | "validate1" | "validate" | "cancel"

export const LEAVE_STATES: readonly LeaveState[] = [
  "confirm",
  "refuse",
  "validate1",
  "validate",
  "cancel",
]

/** Pending and approved requests: a refused or cancelled one doesn't count. */
export const COUNTED_LEAVE_STATES: readonly LeaveState[] = [
  "confirm",
  "validate1",
  "validate",
]

/** The hr.leave fields telling which days, half days or hours a request takes. */
export const LEAVE_SPAN_FIELDS = [
  "holiday_status_id",
  "request_date_from",
  "request_date_to",
  "request_unit_half",
  "request_unit_hours",
  "request_date_from_period",
  "request_date_to_period",
  "request_hour_from",
  "request_hour_to",
]

/**
 * Public holidays (resource.calendar.leaves without a resource) matching
 * `period`, a domain on date_from and date_to. They are company-wide: those
 * of another working schedule than the user's are left out when Odoo tells
 * the user's; none without access to them.
 */
export async function readPublicHolidayRecords(
  session: OdooSession,
  period: unknown[]
): Promise<Record<string, unknown>[]> {
  let records: unknown
  let calendarId: number | null = null
  try {
    const [found, users] = await Promise.all([
      executeKw(
        session,
        "resource.calendar.leaves",
        "search_read",
        [[["resource_id", "=", false], ...period]],
        { fields: ["name", "date_from", "date_to", "calendar_id"] }
      ),
      executeKw(session, "res.users", "read", [[session.uid]], {
        fields: ["resource_calendar_id"],
      }).catch(() => null),
    ])
    records = found
    const user = Array.isArray(users) ? users[0] : undefined
    calendarId = isRecord(user)
      ? (readMany2one(user.resource_calendar_id)?.id ?? null)
      : null
  } catch (error) {
    // No access to the holidays: only the user's own time off counts.
    if (error instanceof OdooRpcError) return []
    throw error
  }
  return (Array.isArray(records) ? records : []).flatMap(
    (record): Record<string, unknown>[] => {
      if (!isRecord(record)) return []
      const calendar = readMany2one(record.calendar_id)
      if (
        calendar !== null &&
        calendarId !== null &&
        calendar.id !== calendarId
      ) {
        return []
      }
      return [record]
    }
  )
}
