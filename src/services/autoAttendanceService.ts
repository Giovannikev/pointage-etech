import { invokeFunction } from "@/services/edgeFunctionClient"
import { detectTimezone } from "@/services/reminderService"
import { getSupabaseClient } from "@/services/supabaseClient"
import { isRecord } from "@/utils/guards"

/**
 * Automatic attendance preferences, read and written straight from the
 * browser: nothing in them is secret, and RLS limits each user to their own
 * row (supabase/migrations/20261030000000_auto_attendance.sql). The day's
 * plan comes from the auto-attendance Edge Function, which reads Odoo.
 */

const TABLE = "auto_attendance_preferences"
const FUNCTION = "auto-attendance"

export interface AutoAttendancePreferences {
  enabled: boolean
  /** IANA time zone, e.g. "Indian/Antananarivo". */
  timezone: string
  /** Local times, "HH:MM". */
  morningStart: string
  morningEnd: string
  afternoonStart: string
  /** The check-out at the office. */
  afternoonEnd: string
  /** The check-out on a remote work afternoon; null for afternoonEnd. */
  remoteAfternoonEnd: string | null
  /** Each punch falls at a random minute up to this many after its time. */
  randomWindowMinutes: number
}

export const MAX_RANDOM_WINDOW = 60

export function defaultAutoAttendance(): AutoAttendancePreferences {
  return {
    enabled: false,
    timezone: detectTimezone(),
    morningStart: "09:00",
    morningEnd: "12:30",
    afternoonStart: "13:30",
    afternoonEnd: "17:30",
    remoteAfternoonEnd: "18:00",
    randomWindowMinutes: 10,
  }
}

export interface PlannedPunch {
  /** Local "HH:MM". */
  time: string
  action: "in" | "out"
}

export interface AutoAttendancePlan {
  instance: string
  /** Local YYYY-MM-DD. */
  date: string
  workingDay: boolean
  remote: boolean
  checkedIn: boolean
  holidays: number
  timeOff: { type: string; counted: boolean }[]
  punches: PlannedPunch[]
  /** ISO timestamp of the next punch, as of the cron's last Odoo read. */
  nextPunchAt: string | null
}

/** "09:00:00" (a Postgres time) as "09:00". */
function toClock(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}/.test(value)
    ? value.slice(0, 5)
    : null
}

async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  const userId = data.session?.user.id
  if (error !== null || userId === undefined) {
    throw new Error("Your session has expired. Sign in again.")
  }
  return userId
}

/** The saved preferences, or null when the user never saved any. */
export async function fetchAutoAttendance(): Promise<AutoAttendancePreferences | null> {
  const userId = await requireUserId()
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select(
      "enabled, timezone, morning_start, morning_end, afternoon_start, afternoon_end, remote_afternoon_end, random_window_minutes"
    )
    .eq("user_id", userId)
    .maybeSingle()
  if (error !== null) {
    throw new Error(error.message)
  }
  if (data === null) {
    return null
  }
  const row: unknown = data
  const morningStart = isRecord(row) ? toClock(row.morning_start) : null
  const morningEnd = isRecord(row) ? toClock(row.morning_end) : null
  const afternoonStart = isRecord(row) ? toClock(row.afternoon_start) : null
  const afternoonEnd = isRecord(row) ? toClock(row.afternoon_end) : null
  if (
    !isRecord(row) ||
    typeof row.enabled !== "boolean" ||
    typeof row.timezone !== "string" ||
    morningStart === null ||
    morningEnd === null ||
    afternoonStart === null ||
    afternoonEnd === null
  ) {
    throw new Error("The automatic attendance settings are unreadable.")
  }
  return {
    enabled: row.enabled,
    timezone: row.timezone,
    morningStart,
    morningEnd,
    afternoonStart,
    afternoonEnd,
    remoteAfternoonEnd: toClock(row.remote_afternoon_end),
    randomWindowMinutes:
      typeof row.random_window_minutes === "number"
        ? row.random_window_minutes
        : 0,
  }
}

export async function saveAutoAttendance(
  preferences: AutoAttendancePreferences
): Promise<void> {
  const userId = await requireUserId()
  const { error } = await getSupabaseClient().from(TABLE).upsert(
    {
      user_id: userId,
      enabled: preferences.enabled,
      timezone: preferences.timezone,
      morning_start: preferences.morningStart,
      morning_end: preferences.morningEnd,
      afternoon_start: preferences.afternoonStart,
      afternoon_end: preferences.afternoonEnd,
      remote_afternoon_end: preferences.remoteAfternoonEnd,
      random_window_minutes: preferences.randomWindowMinutes,
      // The times changed: the cron reads Odoo again at its next run.
      next_punch_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  if (error !== null) {
    throw new Error(error.message)
  }
}

function toPlan(value: unknown): AutoAttendancePlan {
  if (
    !isRecord(value) ||
    typeof value.instance !== "string" ||
    typeof value.date !== "string" ||
    !Array.isArray(value.punches) ||
    !Array.isArray(value.timeOff)
  ) {
    throw new Error(`${FUNCTION} returned an unexpected response.`)
  }
  return {
    instance: value.instance,
    date: value.date,
    workingDay: value.workingDay === true,
    remote: value.remote === true,
    checkedIn: value.checkedIn === true,
    holidays: typeof value.holidays === "number" ? value.holidays : 0,
    timeOff: value.timeOff.flatMap((item) =>
      isRecord(item) && typeof item.type === "string"
        ? [{ type: item.type, counted: item.counted === true }]
        : []
    ),
    punches: value.punches.flatMap((item): PlannedPunch[] =>
      isRecord(item) &&
      typeof item.time === "string" &&
      (item.action === "in" || item.action === "out")
        ? [{ time: item.time, action: item.action }]
        : []
    ),
    nextPunchAt:
      typeof value.nextPunchAt === "string" ? value.nextPunchAt : null,
  }
}

/** Today's planned punches as the cron sees them; null without settings. */
export async function fetchAutoAttendancePlan(): Promise<AutoAttendancePlan | null> {
  const data = await invokeFunction(FUNCTION, { body: { action: "PLAN" } })
  if (!isRecord(data)) {
    throw new Error(`${FUNCTION} returned an unexpected response.`)
  }
  return data.plan === null ? null : toPlan(data.plan)
}

/** "09:00" as minutes since midnight; null when malformed. */
export function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null
}

/** Hours expected on a day of this schedule, at the office or remote. */
export function expectedHours(
  preferences: AutoAttendancePreferences,
  remote: boolean
): number | null {
  const morningStart = clockMinutes(preferences.morningStart)
  const morningEnd = clockMinutes(preferences.morningEnd)
  const afternoonStart = clockMinutes(preferences.afternoonStart)
  const afternoonEnd = clockMinutes(
    remote && preferences.remoteAfternoonEnd !== null
      ? preferences.remoteAfternoonEnd
      : preferences.afternoonEnd
  )
  if (
    morningStart === null ||
    morningEnd === null ||
    afternoonStart === null ||
    afternoonEnd === null
  ) {
    return null
  }
  return (morningEnd - morningStart + afternoonEnd - afternoonStart) / 60
}

/** Why the schedule can't be saved; null when it can. */
export function scheduleProblem(
  preferences: AutoAttendancePreferences
): "order" | "remote" | "window" | null {
  const times = [
    preferences.morningStart,
    preferences.morningEnd,
    preferences.afternoonStart,
    preferences.afternoonEnd,
  ].map(clockMinutes)
  if (
    times.some((time) => time === null) ||
    !((times[0] as number) < (times[1] as number)) ||
    !((times[1] as number) <= (times[2] as number)) ||
    !((times[2] as number) < (times[3] as number))
  ) {
    return "order"
  }
  if (preferences.remoteAfternoonEnd !== null) {
    const remote = clockMinutes(preferences.remoteAfternoonEnd)
    if (remote === null || remote <= (times[2] as number)) return "remote"
  }
  const minutes = preferences.randomWindowMinutes
  if (
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > MAX_RANDOM_WINDOW
  ) {
    return "window"
  }
  return null
}
