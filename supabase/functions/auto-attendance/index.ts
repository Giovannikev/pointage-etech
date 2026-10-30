/**
 * auto-attendance — Supabase Edge Function (Deno)
 *
 * Called by pg_cron every 15 minutes (supabase/cron/auto-attendance.sql),
 * never by browsers: deploy it with JWT verification off and protect it with
 * the CRON_SECRET header.
 *
 * For each user with it on, on working days, it checks them in and out in
 * Odoo at the times of their schedule (09:00-12:30 and 13:30-18:00 by
 * default), minus their time off: no punch on a day off, only the other
 * half on a half day, and out/in around hours off. Public holidays count as
 * days off. Requests waiting for approval count too, so a refused request
 * leaves the day to check in by hand. Time off of a "worked time" type
 * (remote work, training: time_type "other") doesn't: the user works.
 *
 * It acts only at a planned time, and only when the user's state differs:
 * a check-out by hand stays until the next planned time. A punch that fails
 * is retried by the next runs, for 30 minutes.
 *
 * POST {}                                   the cron run
 * POST { "dryRun": true, "at"?: ISO time }  shows the day's plan, punches nothing
 *
 * Secrets: CRON_SECRET (plus SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CREDENTIALS_ENCRYPTION_KEY).
 */
import {
  readOpenAttendanceId,
  readOwnEmployeeId,
  toggleAttendance,
} from "../_shared/attendance.ts"
import {
  type Interval,
  leaveOffIntervals,
  type LeaveSpan,
  localMidnight,
  localMoment,
  parseClock,
  type Period,
  planPunches,
  type Punch,
  toLocalInterval,
  type WorkSchedule,
} from "../_shared/attendancePlan.ts"
import { getAdminClient } from "../_shared/auth.ts"
import { requireEnv } from "../_shared/env.ts"
import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import { isRecord } from "../_shared/validation.ts"

const TABLE = "auto_attendance_preferences"
/** How long a planned punch that couldn't be made is retried. */
const CATCH_UP_MINUTES = 30
/** Pending and approved requests: a refused or cancelled one doesn't count. */
const LEAVE_STATES = ["confirm", "validate1", "validate"]
const LEAVE_FIELDS = [
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

interface Preference {
  userId: string
  timezone: string
  schedule: WorkSchedule
  /** The last planned punch handled, so it isn't made twice. */
  lastPunchAt: Date | null
}

type Outcome =
  | "idle"
  | "checked_in"
  | "checked_out"
  | "already_right"
  | "failed"

/** A request found on the day, and whether it takes time off. */
interface FoundLeave {
  type: string
  counted: boolean
}

interface DayPlan {
  date: string
  punches: Punch[]
  leaves: FoundLeave[]
  holidays: number
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Compares secrets in constant time, so timing doesn't leak them. */
function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i]
  }
  return difference === 0
}

function readInterval(start: unknown, end: unknown): Interval | null {
  if (typeof start !== "string" || typeof end !== "string") return null
  const from = parseClock(start)
  const to = parseClock(end)
  return from !== null && to !== null && from < to ? [from, to] : null
}

function readPreference(row: unknown): Preference | null {
  if (
    !isRecord(row) ||
    typeof row.user_id !== "string" ||
    typeof row.timezone !== "string"
  ) {
    return null
  }
  const morning = readInterval(row.morning_start, row.morning_end)
  const afternoon = readInterval(row.afternoon_start, row.afternoon_end)
  if (morning === null || afternoon === null || morning[1] > afternoon[0]) {
    return null
  }
  return {
    userId: row.user_id,
    timezone: row.timezone,
    schedule: { morning, afternoon },
    lastPunchAt:
      typeof row.last_punch_at === "string"
        ? new Date(row.last_punch_at)
        : null,
  }
}

/** "HH:MM" of a minute of the day, for the dry run. */
function clock(minute: number): string {
  const rounded = Math.round(minute)
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`
}

/** Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS". */
function readOdooDatetime(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(`${value.replace(" ", "T")}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** An Odoo datetime for a domain. */
function toOdooDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}

/* ------------------------------------------------------------------ */
/* Odoo                                                                */
/* ------------------------------------------------------------------ */

/** The first instance with the Attendances app and an employee for the user. */
async function findAttendanceInstance(
  userId: string
): Promise<{ session: OdooSession; employeeId: number }> {
  const instances = (await loadSettings(userId)).odooInstances
  const getSession = createSessionPool(instances)
  for (const { index } of instances) {
    const session = await getSession(index)
    try {
      await executeKw(session, "hr.attendance", "fields_get", [], {
        attributes: ["type"],
      })
    } catch (error) {
      // "Object hr.attendance doesn't exist": the app isn't installed.
      if (error instanceof OdooRpcError) continue
      throw error
    }
    const employeeId = await readOwnEmployeeId(session)
    if (employeeId !== null) return { session, employeeId }
  }
  throw new HttpError("No Odoo instance with Attendances for this user.", 400)
}

function readLeaveSpan(record: unknown): LeaveSpan | null {
  if (!isRecord(record)) return null
  const dateFrom =
    typeof record.request_date_from === "string"
      ? record.request_date_from.slice(0, 10)
      : null
  const dateTo =
    typeof record.request_date_to === "string"
      ? record.request_date_to.slice(0, 10)
      : dateFrom
  if (dateFrom === null || dateTo === null) return null

  if (record.request_unit_hours === true) {
    // A float from Odoo 17, a selection like "9.5" before.
    const hourFrom = Number(record.request_hour_from)
    const hourTo = Number(record.request_hour_to)
    if (!Number.isFinite(hourFrom) || !Number.isFinite(hourTo)) {
      // Unknown hours: better no punch than one in the middle of time off.
      return { unit: "day", dateFrom, dateTo: dateFrom }
    }
    return { unit: "hour", date: dateFrom, hourFrom, hourTo }
  }
  if (record.request_unit_half === true) {
    const readPeriod = (value: unknown): Period | null =>
      value === "am" || value === "pm" ? value : null
    const fromPeriod = readPeriod(record.request_date_from_period) ?? "am"
    // Before Odoo 18 a half day is a single half: it ends where it starts.
    const toPeriod = readPeriod(record.request_date_to_period) ?? fromPeriod
    return { unit: "half_day", dateFrom, dateTo, fromPeriod, toPeriod }
  }
  return { unit: "day", dateFrom, dateTo }
}

/** The types of `typeIds` that are worked time, not absences (time_type "other"). */
async function readWorkedTimeTypes(
  session: OdooSession,
  typeIds: number[]
): Promise<Set<number>> {
  if (typeIds.length === 0) return new Set()
  const types = await executeKw(session, "hr.leave.type", "read", [typeIds], {
    fields: ["time_type"],
  }).catch((error: unknown) => {
    // Odoo without time_type: every type is an absence.
    if (error instanceof OdooRpcError) return []
    throw error
  })
  return new Set(
    (Array.isArray(types) ? types : []).flatMap((type) =>
      isRecord(type) && typeof type.id === "number" && type.time_type === "other"
        ? [type.id]
        : []
    )
  )
}

/** The user's pending or approved requests covering `date`; only absences take time off. */
async function readLeaves(
  session: OdooSession,
  employeeId: number,
  date: string
): Promise<{ spans: LeaveSpan[]; found: FoundLeave[] }> {
  const description = await executeKw(session, "hr.leave", "fields_get", [], {
    attributes: ["type"],
  })
  const fields = LEAVE_FIELDS.filter(
    (field) => isRecord(description) && field in description
  )
  const records = await executeKw(
    session,
    "hr.leave",
    "search_read",
    [
      [
        ["employee_id", "=", employeeId],
        ["state", "in", LEAVE_STATES],
        ["request_date_from", "<=", date],
        ["request_date_to", ">=", date],
      ],
    ],
    { fields }
  )
  if (!Array.isArray(records)) {
    throw new HttpError(`${session.connection.label} answered badly.`, 502)
  }
  const types = records.map((record) =>
    isRecord(record) ? readMany2one(record.holiday_status_id) : null
  )
  const workedTime = await readWorkedTimeTypes(session, [
    ...new Set(types.flatMap((type) => (type === null ? [] : [type.id]))),
  ])
  const spans: LeaveSpan[] = []
  const found: FoundLeave[] = []
  records.forEach((record, index) => {
    const type = types[index]
    const counted = type === null || !workedTime.has(type.id)
    found.push({ type: type?.name ?? "?", counted })
    const span = counted ? readLeaveSpan(record) : null
    if (span !== null) spans.push(span)
  })
  return { spans, found }
}

/**
 * Public holidays of the day (resource.calendar.leaves without a resource),
 * as local intervals. They are company-wide: those of another working
 * schedule than the user's are left out when Odoo tells the user's.
 */
async function readHolidays(
  session: OdooSession,
  dayStart: Date
): Promise<Interval[]> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
  let records: unknown
  let calendarId: number | null = null
  try {
    const [found, users] = await Promise.all([
      executeKw(
        session,
        "resource.calendar.leaves",
        "search_read",
        [
          [
            ["resource_id", "=", false],
            ["date_from", "<", toOdooDatetime(dayEnd)],
            ["date_to", ">", toOdooDatetime(dayStart)],
          ],
        ],
        { fields: ["date_from", "date_to", "calendar_id"] }
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
  if (!Array.isArray(records)) return []
  return records.flatMap((record): Interval[] => {
    if (!isRecord(record)) return []
    const calendar = readMany2one(record.calendar_id)
    if (calendar !== null && calendarId !== null && calendar.id !== calendarId) {
      return []
    }
    const from = readOdooDatetime(record.date_from)
    const to = readOdooDatetime(record.date_to)
    const interval =
      from === null || to === null ? null : toLocalInterval(from, to, dayStart)
    return interval === null ? [] : [interval]
  })
}

async function planDay(
  session: OdooSession,
  employeeId: number,
  preference: Preference,
  date: string
): Promise<DayPlan> {
  const dayStart = localMidnight(date, preference.timezone)
  const [leaves, holidays] = await Promise.all([
    readLeaves(session, employeeId, date),
    readHolidays(session, dayStart),
  ])
  const off = [
    ...leaves.spans.flatMap((leave) =>
      leaveOffIntervals(leave, date, preference.schedule)
    ),
    ...holidays,
  ]
  return {
    date,
    punches: planPunches(preference.schedule, off),
    leaves: leaves.found,
    holidays: holidays.length,
  }
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

/** True when the run can't have a punch to make: no Odoo call then. */
function outsideWorkingHours(preference: Preference, now: Date): boolean {
  const local = localMoment(now, preference.timezone)
  if (local === null || local.weekday > 5) return true
  const { morning, afternoon } = preference.schedule
  // Time off only removes work: every punch falls within the schedule.
  return (
    local.minute < morning[0] ||
    local.minute > afternoon[1] + CATCH_UP_MINUTES
  )
}

async function punch(preference: Preference, now: Date): Promise<Outcome> {
  if (outsideWorkingHours(preference, now)) return "idle"
  const local = localMoment(now, preference.timezone)
  if (local === null) return "idle"

  const { session, employeeId } = await findAttendanceInstance(
    preference.userId
  )
  const plan = await planDay(session, employeeId, preference, local.date)
  const dayStart = localMidnight(local.date, preference.timezone)
  const after = Math.max(
    preference.lastPunchAt?.getTime() ?? 0,
    now.getTime() - CATCH_UP_MINUTES * 60_000
  )
  const due = plan.punches
    .map((planned) => ({
      ...planned,
      at: new Date(dayStart.getTime() + planned.minute * 60_000),
    }))
    .filter(({ at }) => at.getTime() > after && at.getTime() <= now.getTime())
  // Several due (a missed run): the latest one sets the state.
  const latest = due.at(-1)
  if (latest === undefined) return "idle"

  const isIn = (await readOpenAttendanceId(session, employeeId)) !== null
  let outcome: Outcome = "already_right"
  if ((latest.action === "in") !== isIn) {
    await toggleAttendance(session, employeeId)
    outcome = latest.action === "in" ? "checked_in" : "checked_out"
  }

  const { error } = await getAdminClient()
    .from(TABLE)
    .update({ last_punch_at: latest.at.toISOString() })
    .eq("user_id", preference.userId)
  if (error !== null) {
    throw new HttpError(`Couldn't record the punch: ${error.message}`, 500)
  }
  console.log(
    `auto-attendance: user ${preference.userId}: ${outcome} for ${clock(latest.minute)} (${plan.leaves.filter((leave) => leave.counted).length} time off, ${plan.holidays} holidays)`
  )
  return outcome
}

/** The day's plan of each user, without punching. */
async function dryRun(preferences: Preference[], now: Date) {
  return await Promise.all(
    preferences.map(async (preference) => {
      const local = localMoment(now, preference.timezone)
      if (local === null) {
        return { userId: preference.userId, error: "Unknown time zone." }
      }
      try {
        const { session, employeeId } = await findAttendanceInstance(
          preference.userId
        )
        const plan = await planDay(session, employeeId, preference, local.date)
        const isIn = (await readOpenAttendanceId(session, employeeId)) !== null
        return {
          userId: preference.userId,
          instance: session.connection.label,
          date: plan.date,
          workingDay: local.weekday <= 5,
          timeOff: plan.leaves.map(
            ({ type, counted }) =>
              `${type}${counted ? "" : " (worked time, ignored)"}`
          ),
          holidays: plan.holidays,
          checkedIn: isIn,
          punches: plan.punches.map(
            ({ minute, action }) => `${clock(minute)} ${action}`
          ),
        }
      } catch (failure) {
        return {
          userId: preference.userId,
          error: failure instanceof Error ? failure.message : String(failure),
        }
      }
    })
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405)
  }
  try {
    const expected = requireEnv("CRON_SECRET")
    const provided = request.headers.get("x-cron-secret") ?? ""
    if (!safeEqual(provided, expected)) {
      return json({ error: "Forbidden." }, 403)
    }
    const body: unknown = await request.json().catch(() => ({}))

    const { data, error } = await getAdminClient()
      .from(TABLE)
      .select(
        "user_id, timezone, morning_start, morning_end, afternoon_start, afternoon_end, last_punch_at"
      )
      .eq("enabled", true)
    if (error !== null) {
      throw new HttpError(
        `Couldn't read the preferences: ${error.message}`,
        500
      )
    }
    const preferences = (data ?? []).flatMap(
      (row: unknown) => readPreference(row) ?? []
    )

    if (isRecord(body) && body.dryRun === true) {
      const at = typeof body.at === "string" ? new Date(body.at) : new Date()
      if (Number.isNaN(at.getTime())) {
        return json({ error: "at must be an ISO date and time." }, 400)
      }
      return json({ dryRun: true, users: await dryRun(preferences, at) })
    }

    const now = new Date()
    const summary: Record<Outcome, number> = {
      idle: 0,
      checked_in: 0,
      checked_out: 0,
      already_right: 0,
      failed: 0,
    }
    // One user at a time: a slow or failing Odoo only delays the others.
    for (const preference of preferences) {
      try {
        summary[await punch(preference, now)] += 1
      } catch (failure) {
        summary.failed += 1
        console.error(
          `auto-attendance: user ${preference.userId}:`,
          failure instanceof Error ? failure.message : failure
        )
      }
    }
    return json(summary)
  } catch (failure) {
    if (failure instanceof HttpError) {
      return json({ error: failure.message }, failure.status)
    }
    console.error("auto-attendance: unexpected error", failure)
    return json({ error: "Unexpected server error." }, 500)
  }
})
