import {
  readOpenAttendanceRecord,
  readOwnEmployeeId,
  toggleAttendance,
} from "../_shared/attendance.ts"
import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  executeKw,
  type OdooSession,
} from "../_shared/odoo.ts"
import { optionalModelFields } from "../_shared/odooFields.ts"
import type {
  InstanceIndex,
  OdooInstanceSettings,
} from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import type { Attendance, AttendanceResult, HistoryQuery } from "./contract.ts"
import {
  asConflict,
  MS_PER_DAY,
  readDeadline,
  readEachInstance,
  readNumber,
  readRecords,
  selectInstances,
} from "./helpers.ts"

const ATTENDANCE_LIMIT = 1_000

/* ------------------------------------------------------------------ */
/* Attendance (hr_attendance)                                          */
/* ------------------------------------------------------------------ */

const ATTENDANCE_FIELDS = ["id", "check_in", "check_out", "worked_hours"]

function readAttendance(record: unknown): Attendance | null {
  if (!isRecord(record) || !isPositiveInteger(record.id)) {
    return null
  }
  // readDeadline turns Odoo's UTC datetimes into ISO timestamps.
  const checkIn = readDeadline(record.check_in)
  if (checkIn === null) {
    return null
  }
  return {
    attendanceId: record.id,
    checkIn,
    checkOut: readDeadline(record.check_out),
    workedHours: readNumber(record.worked_hours) ?? 0,
  }
}

/** The user's attendance still open (checked in, not out yet). */
async function readOpenAttendance(
  session: OdooSession,
  employeeId: number
): Promise<Attendance | null> {
  return readAttendance(
    await readOpenAttendanceRecord(session, employeeId, ATTENDANCE_FIELDS)
  )
}

export function getAttendance(
  instances: OdooInstanceSettings[],
  { dateFrom, dateTo, instanceIndex }: HistoryQuery
): Promise<AttendanceResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session) => {
      const unavailable = {
        available: false,
        openSince: null,
        attendances: [],
        truncated: false,
      }
      if ((await optionalModelFields(session, "hr.attendance")) === null) {
        return unavailable
      }
      const employeeId = await readOwnEmployeeId(session)
      if (employeeId === null) {
        return unavailable
      }
      // The period's days in UTC, widened by a day on each side: the page
      // keeps the check-ins of its local days.
      const from = new Date(Date.parse(`${dateFrom}T00:00:00Z`) - MS_PER_DAY)
      const to = new Date(Date.parse(`${dateTo}T00:00:00Z`) + 2 * MS_PER_DAY)
      const [records, open] = await Promise.all([
        executeKw(
          session,
          "hr.attendance",
          "search_read",
          [
            [
              ["employee_id", "=", employeeId],
              ["check_in", ">=", from.toISOString().slice(0, 10)],
              ["check_in", "<", to.toISOString().slice(0, 10)],
            ],
          ],
          {
            fields: ATTENDANCE_FIELDS,
            limit: ATTENDANCE_LIMIT,
            order: "check_in desc",
          }
        ),
        readOpenAttendance(session, employeeId),
      ])
      const raw = readRecords(records, session, "attendance")
      return {
        available: true,
        openSince: open?.checkIn ?? null,
        attendances: raw.flatMap((record) => readAttendance(record) ?? []),
        truncated: raw.length >= ATTENDANCE_LIMIT,
      }
    }
  )
}

/**
 * Checks the user in, or out when an attendance is open. With a direction,
 * nothing is done when Odoo is already in that state (a punch from Odoo or
 * another device since the app last read it, or two buttons clicked at
 * once): a toggle would undo it.
 */
export async function checkInOut(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex,
  direction: "in" | "out" | null
): Promise<{ openSince: string | null; changed: boolean }> {
  const session = await createSessionPool(instances)(instanceIndex)
  const employeeId = await readOwnEmployeeId(session)
  if (employeeId === null) {
    throw new HttpError(
      `Your user has no employee on ${session.connection.label}.`,
      409
    )
  }
  if (direction !== null) {
    const current = await readOpenAttendance(session, employeeId)
    if ((current !== null) === (direction === "in")) {
      return { openSince: current?.checkIn ?? null, changed: false }
    }
  }
  await asConflict(toggleAttendance(session, employeeId))
  const open = await readOpenAttendance(session, employeeId)
  return { openSince: open?.checkIn ?? null, changed: true }
}
