import type {
  Attendance,
  CommitPeriod,
  LeaveRequest,
  LeaveState,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { toLocalIsoDate } from "@/utils/date"
import { isInPeriod } from "@/utils/period"

/** One local day of attendances, newest day first. */
export interface AttendanceDay {
  date: string
  attendances: Attendance[]
  hours: number
}

/**
 * Groups the attendances of the period by the local day of their check-in.
 * An open attendance counts the time elapsed until `now`.
 */
export function groupAttendanceByDay(
  attendances: Attendance[],
  period: CommitPeriod,
  now: Date
): AttendanceDay[] {
  const days = new Map<string, AttendanceDay>()
  for (const attendance of attendances) {
    const date = toLocalIsoDate(attendance.checkIn)
    if (!isInPeriod(date, period)) continue
    const day = days.get(date) ?? { date, attendances: [], hours: 0 }
    day.attendances.push(attendance)
    day.hours += attendanceHours(attendance, now)
    days.set(date, day)
  }
  for (const day of days.values()) {
    day.attendances.sort((a, b) => a.checkIn.localeCompare(b.checkIn))
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Time present during an attendance, from check-in to check-out (or `now`
 * while it runs), as Odoo's attendance button totals it. Odoo's worked_hours
 * field would deduct the lunch break of the working schedule instead.
 */
export function attendanceHours(attendance: Attendance, now: Date): number {
  const end = attendance.checkOut === null ? now : new Date(attendance.checkOut)
  const elapsed = end.getTime() - new Date(attendance.checkIn).getTime()
  return Math.max(0, elapsed / 3_600_000)
}

/** "09:30" for 9.5, as Odoo stores the hours of an hour-based request. */
export function formatHourOfDay(hour: number): string {
  const minutes = Math.round(hour * 60)
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0")
  const mm = String(minutes % 60).padStart(2, "0")
  return `${hh}:${mm}`
}

/** 9.5 for "09:30"; null for anything else. */
export function parseHourOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  return hours + minutes / 60
}

/** Requests still to come or running come first, then the past ones. */
export function splitRequests(
  requests: LeaveRequest[],
  today: string
): { upcoming: LeaveRequest[]; past: LeaveRequest[] } {
  const upcoming = requests
    .filter((request) => request.dateTo >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
  const past = requests
    .filter((request) => request.dateTo < today)
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))
  return { upcoming, past }
}

/** Badge tone of a request state. */
export function leaveStateTone(
  state: LeaveState
): "pending" | "approved" | "refused" | "canceled" {
  switch (state) {
    case "confirm":
    case "validate1":
      return "pending"
    case "validate":
      return "approved"
    case "refuse":
      return "refused"
    case "cancel":
      return "canceled"
  }
}

export function leaveKey(request: {
  instanceIndex: OdooInstanceIndex
  leaveId: number
}): string {
  return `${request.instanceIndex}:${request.leaveId}`
}
