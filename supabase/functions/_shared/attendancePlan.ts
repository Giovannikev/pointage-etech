/**
 * The day's planned check-ins and check-outs: the work schedule, minus the
 * time off. Pure functions, shared with the tests (scripts/).
 */

/** Minutes since local midnight. */
export type Minute = number

/** [start, end) in minutes since local midnight. */
export type Interval = readonly [Minute, Minute]

export interface WorkSchedule {
  morning: Interval
  afternoon: Interval
}

export type Period = "am" | "pm"

/** A time off request as Odoo describes it (hr.leave). */
export type LeaveSpan =
  | { unit: "day"; dateFrom: string; dateTo: string }
  | {
      unit: "half_day"
      dateFrom: string
      dateTo: string
      fromPeriod: Period
      toPeriod: Period
    }
  | { unit: "hour"; date: string; hourFrom: number; hourTo: number }

export interface Punch {
  minute: Minute
  action: "in" | "out"
}

const DAY: Interval = [0, 24 * 60]

/** "09:00" or "09:00:00" (a Postgres time) as minutes; null when malformed. */
export function parseClock(value: string): Minute | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** The periods a half-day request takes on `date`, from its first to its last half day. */
function halfDayPeriods(
  leave: Extract<LeaveSpan, { unit: "half_day" }>,
  date: string
): Period[] {
  const starts = date === leave.dateFrom ? leave.fromPeriod : "am"
  const ends = date === leave.dateTo ? leave.toPeriod : "pm"
  if (starts === "pm" && ends === "am") return []
  return starts === ends ? [starts] : ["am", "pm"]
}

/** The part of `date` a request takes off; none when it doesn't cover the day. */
export function leaveOffIntervals(
  leave: LeaveSpan,
  date: string,
  schedule: WorkSchedule
): Interval[] {
  if (leave.unit === "hour") {
    return leave.date === date
      ? [[Math.round(leave.hourFrom * 60), Math.round(leave.hourTo * 60)]]
      : []
  }
  if (date < leave.dateFrom || date > leave.dateTo) return []
  if (leave.unit === "day") return [DAY]
  // A half day is the whole morning or afternoon of the schedule: a
  // morning off ends at lunch, whatever hours Odoo's calendar gives it.
  return halfDayPeriods(leave, date).map((period) =>
    period === "am" ? [0, schedule.morning[1]] : [schedule.afternoon[0], DAY[1]]
  )
}

function subtract(work: Interval, off: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [work]
  for (const [offStart, offEnd] of off) {
    pieces = pieces.flatMap(([start, end]): Interval[] => {
      if (offEnd <= start || offStart >= end) return [[start, end]]
      const kept: Interval[] = []
      if (offStart > start) kept.push([start, offStart])
      if (offEnd < end) kept.push([offEnd, end])
      return kept
    })
  }
  return pieces
}

/** Check in at the start of each worked stretch, out at its end. */
export function planPunches(
  schedule: WorkSchedule,
  off: readonly Interval[]
): Punch[] {
  return [schedule.morning, schedule.afternoon]
    .flatMap((work) => subtract(work, off))
    .sort((a, b) => a[0] - b[0])
    .flatMap(([start, end]): Punch[] => [
      { minute: start, action: "in" },
      { minute: end, action: "out" },
    ])
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

export interface LocalMoment {
  /** YYYY-MM-DD in the time zone. */
  date: string
  minute: Minute
  /** 1 (Monday) to 7 (Sunday). */
  weekday: number
}

/** The local date, minute and weekday of `at`; null for an unknown time zone. */
export function localMoment(at: Date, timezone: string): LocalMoment | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at)
  } catch {
    return null
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ""
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
    weekday: WEEKDAYS[part("weekday")] ?? 0,
  }
}

/** The instant of local midnight starting `date` in the time zone. */
export function localMidnight(date: string, timezone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`)
  const seen = localMoment(guess, timezone)
  if (seen === null) return guess
  // The zone's offset at that instant, in minutes (Madagascar: +180).
  const dayShift = seen.date === date ? 0 : seen.date > date ? 1 : -1
  const offset = dayShift * 24 * 60 + seen.minute
  return new Date(guess.getTime() - offset * 60_000)
}

/** An instant range (e.g. a public holiday) as the minutes it covers on the local day. */
export function toLocalInterval(
  from: Date,
  to: Date,
  dayStart: Date
): Interval | null {
  const start = Math.max(0, (from.getTime() - dayStart.getTime()) / 60_000)
  const end = Math.min(DAY[1], (to.getTime() - dayStart.getTime()) / 60_000)
  return end > start ? [start, end] : null
}
