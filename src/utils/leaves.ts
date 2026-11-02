import type {
  Attendance,
  CommitPeriod,
  LeaveRequest,
  LeaveState,
  LeaveType,
  OdooInstanceIndex,
  PublicHoliday,
} from "@/types/timesheet"
import { addDays, countDays, startOfDay, toLocalIsoDate } from "@/utils/date"
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

/** "7:26" for 7.44 hours, as Odoo shows durations; minutes are rounded. */
export function formatDuration(hours: number): string {
  const minutes = Math.round(Math.max(0, hours) * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
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

/** A refused or cancelled request takes no time. */
export function isActiveRequest(request: LeaveRequest): boolean {
  return request.state !== "refuse" && request.state !== "cancel"
}

function covers(request: LeaveRequest, date: string): boolean {
  return request.dateFrom <= date && date <= request.dateTo
}

/** Monday to Friday. */
export function isWeekday(date: string): boolean {
  const day = startOfDay(date).getDay()
  return day !== 0 && day !== 6
}

/** The local dates each public holiday covers. */
export function holidayDates(holidays: PublicHoliday[]): Map<string, string> {
  const dates = new Map<string, string>()
  for (const holiday of holidays) {
    const first = toLocalIsoDate(holiday.from)
    // Odoo ends a holiday at 23:59:59 local or at the next midnight.
    const end = new Date(new Date(holiday.to).getTime() - 1000).toISOString()
    const last = toLocalIsoDate(end)
    for (let date = first; date <= last; date = addDays(date, 1)) {
      dates.set(date, holiday.name)
    }
  }
  return dates
}

/** The ids ("instance:type") of the worked time types: remote work, training. */
export function workedTimeTypeKeys(types: LeaveType[]): Set<string> {
  return new Set(
    types
      .filter((type) => type.workedTime)
      .map((type) => `${type.instanceIndex}:${type.leaveTypeId}`)
  )
}

function isWorkedTime(request: LeaveRequest, workedTypes: Set<string>) {
  return workedTypes.has(`${request.instanceIndex}:${request.leaveTypeId}`)
}

/** Absences (not worked time) covering `date`. */
export function absencesOn(
  requests: LeaveRequest[],
  workedTypes: Set<string>,
  date: string
): LeaveRequest[] {
  return requests.filter(
    (request) =>
      isActiveRequest(request) &&
      !isWorkedTime(request, workedTypes) &&
      covers(request, date)
  )
}

/**
 * True when remote work covers the end of `date`, as the automatic
 * check-out sees it: a whole day, an afternoon, or hours until the evening.
 */
export function isRemoteDay(
  requests: LeaveRequest[],
  workedTypes: Set<string>,
  date: string,
  /** The office check-out, in hours: 17.5 for 17:30. */
  dayEnd = 17.5
): boolean {
  return requests.some(
    (request) =>
      isActiveRequest(request) &&
      isWorkedTime(request, workedTypes) &&
      covers(request, date) &&
      request.period !== "am" &&
      (request.hourTo === null || request.hourTo >= dayEnd)
  )
}

export type AttendanceAnomaly =
  | { kind: "forgottenCheckOut"; date: string; checkIn: string }
  | { kind: "noAttendance"; date: string }
  | { kind: "short"; date: string; hours: number; expected: number }

/** Below this many hours under the expected day, a day isn't flagged. */
const SHORT_DAY_TOLERANCE = 0.25

/**
 * Days of the period, before today, that need a look: an attendance never
 * checked out, a working day without any attendance, or a day shorter than
 * expected. Days off, public holidays and weekends are left alone.
 */
export function findAttendanceAnomalies({
  days,
  period,
  today,
  requests,
  workedTypes,
  holidays,
  expectedHours,
}: {
  days: AttendanceDay[]
  period: CommitPeriod
  today: string
  requests: LeaveRequest[]
  workedTypes: Set<string>
  holidays: Map<string, string>
  /** Hours expected on a working day, remote or not. */
  expectedHours: (remote: boolean) => number
}): AttendanceAnomaly[] {
  const anomalies: AttendanceAnomaly[] = []
  const byDate = new Map(days.map((day) => [day.date, day]))
  const last = period.to < today ? period.to : addDays(today, -1)
  for (let date = period.from; date <= last; date = addDays(date, 1)) {
    const day = byDate.get(date)
    const open = day?.attendances.find(
      (attendance) => attendance.checkOut === null
    )
    if (open !== undefined) {
      anomalies.push({ kind: "forgottenCheckOut", date, checkIn: open.checkIn })
      continue
    }
    if (
      !isWeekday(date) ||
      holidays.has(date) ||
      absencesOn(requests, workedTypes, date).length > 0
    ) {
      continue
    }
    if (day === undefined) {
      anomalies.push({ kind: "noAttendance", date })
      continue
    }
    const expected = expectedHours(isRemoteDay(requests, workedTypes, date))
    if (day.hours < expected - SHORT_DAY_TOLERANCE) {
      anomalies.push({ kind: "short", date, hours: day.hours, expected })
    }
  }
  return anomalies.sort((a, b) => b.date.localeCompare(a.date))
}

/** The first working day after `date`: not a weekend nor a public holiday. */
export function nextWorkingDay(
  date: string,
  holidays: Map<string, string>
): string {
  let next = addDays(date, 1)
  while (!isWeekday(next) || holidays.has(next)) next = addDays(next, 1)
  return next
}

/** The remote work type: a worked time type named so, or the only one. */
export function findRemoteWorkType(types: LeaveType[]): LeaveType | null {
  const worked = types.filter((type) => type.workedTime)
  return (
    worked.find((type) =>
      /t[ée]l[ée]\s*travail|remote|home|domicile/i.test(type.name)
    ) ?? (worked.length === 1 ? worked[0] : null)
  )
}

/** Working days from `from` to `to`, both included: no weekend nor holiday. */
export function countWorkingDays(
  from: string,
  to: string,
  holidays: Map<string, string>
): number {
  let count = 0
  for (let index = 0; index < countDays(from, to); index += 1) {
    const date = addDays(from, index)
    if (isWeekday(date) && !holidays.has(date)) count += 1
  }
  return count
}

/** The weeks (Monday first) showing a month ("2026-11"), as ISO dates. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`
  // getDay: 0 is Sunday; step back to the Monday of the first week.
  const offset = (startOfDay(first).getDay() + 6) % 7
  let date = addDays(first, -offset)
  const weeks: string[][] = []
  do {
    const week: string[] = []
    for (let day = 0; day < 7; day += 1) {
      week.push(date)
      date = addDays(date, 1)
    }
    weeks.push(week)
  } while (date.slice(0, 7) === month)
  return weeks
}

/**
 * Hours expected over the period, up to today: each working day's hours,
 * less its time off (half a day for a half day, the hours of an hour
 * request), none on public holidays.
 */
export function expectedPeriodHours({
  period,
  today,
  requests,
  workedTypes,
  holidays,
  expectedHours,
}: {
  period: CommitPeriod
  today: string
  requests: LeaveRequest[]
  workedTypes: Set<string>
  holidays: Map<string, string>
  expectedHours: (remote: boolean) => number
}): number {
  let total = 0
  const last = period.to < today ? period.to : today
  for (let date = period.from; date <= last; date = addDays(date, 1)) {
    if (!isWeekday(date) || holidays.has(date)) continue
    const day = expectedHours(isRemoteDay(requests, workedTypes, date))
    const off = absencesOn(requests, workedTypes, date).reduce(
      (sum, request) =>
        sum +
        (request.period !== null
          ? day / 2
          : request.hourFrom !== null && request.hourTo !== null
            ? request.hourTo - request.hourFrom
            : day),
      0
    )
    total += Math.max(0, day - off)
  }
  return total
}
