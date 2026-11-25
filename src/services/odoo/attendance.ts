import {
  cacheKey,
  odooCache,
  type CacheKey,
  type CacheReadOptions,
} from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  GATEWAY_FUNCTION,
  invokeGateway,
  isNullableString,
  readInstanceResults,
  readList,
  toInstanceResult,
} from "@/services/odoo/shared"
import type {
  Attendance,
  AttendanceInstanceResult,
  CommitPeriod,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

const ATTENDANCE_PREFIX = "attendance:"
const ATTENDANCE_TTL_MS = 2 * 60_000

function toAttendance(value: unknown): Attendance {
  if (
    isRecord(value) &&
    isPositiveInteger(value.attendanceId) &&
    typeof value.checkIn === "string" &&
    isNullableString(value.checkOut) &&
    typeof value.workedHours === "number"
  ) {
    return {
      attendanceId: value.attendanceId,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      workedHours: value.workedHours,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function attendanceKey(
  period: CommitPeriod
): CacheKey<AttendanceInstanceResult[]> {
  return cacheKey(`${ATTENDANCE_PREFIX}${period.from}:${period.to}`)
}

/** The user's attendances of the period and current state, per instance. */
export function fetchAttendance(
  period: CommitPeriod,
  options: CacheReadOptions = {}
): Promise<AttendanceInstanceResult[]> {
  return odooCache.getOrFetch(
    attendanceKey(period),
    ATTENDANCE_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({
          action: "GET_ATTENDANCE",
          dateFrom: period.from,
          dateTo: period.to,
        })
      ).map((value) =>
        toInstanceResult(value, (record) => {
          if (!isNullableString(record.openSince)) {
            throw new InvalidResponseError(GATEWAY_FUNCTION)
          }
          return {
            available: record.available === true,
            openSince: record.openSince,
            attendances: readList(record.attendances, toAttendance),
            truncated: record.truncated === true,
          }
        })
      ),
    options
  )
}

export function peekAttendance(
  period: CommitPeriod
): AttendanceInstanceResult[] | undefined {
  return odooCache.peek(attendanceKey(period))
}

const ATTENDANCE_CHANGED = "pointage:attendance-changed"

/**
 * Calls `listener` after every check-in or check-out from the app, so every
 * view showing attendance (page card, floating button) reads it again.
 */
export function onAttendanceChanged(listener: () => void): () => void {
  window.addEventListener(ATTENDANCE_CHANGED, listener)
  return () => window.removeEventListener(ATTENDANCE_CHANGED, listener)
}

/**
 * Checks in or out; resolves with the open check-in afterwards, and whether
 * Odoo changed (false when it was already in that state).
 */
export async function checkInOut(
  instanceIndex: OdooInstanceIndex,
  direction: "in" | "out"
): Promise<{ openSince: string | null; changed: boolean }> {
  try {
    const data = await invokeGateway({
      action: "CHECK_IN_OUT",
      instanceIndex,
      direction,
    })
    if (isRecord(data) && isNullableString(data.openSince)) {
      // An older gateway doesn't say: it always toggles.
      return { openSince: data.openSince, changed: data.changed !== false }
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    odooCache.invalidate(ATTENDANCE_PREFIX)
    window.dispatchEvent(new Event(ATTENDANCE_CHANGED))
  }
}
