/**
 * auto-attendance — Supabase Edge Function (Deno)
 *
 * Called by pg_cron every minute (supabase/cron/auto-attendance.sql),
 * never by browsers: deploy it with JWT verification off and protect it with
 * the CRON_SECRET header.
 *
 * For each user with it on, on working days, it checks them in and out in
 * Odoo at the times of their schedule (09:00-12:30 and 13:30-18:00 by
 * default), minus their time off: no punch on a day off, only the other
 * half on a half day, and out/in around hours off. Public holidays count as
 * days off. Requests waiting for approval count too, so a refused request
 * leaves the day to check in by hand. Time off of a "worked time" type
 * (remote work, training: time_type "other") doesn't: the user works. With
 * remote_afternoon_end, such a request covering the end of the afternoon
 * moves the check-out there (18:00 at home, 17:30 at the office).
 *
 * With random_window_minutes, each punch falls at a random minute after its
 * planned time: 09:00-09:10 for 10. The minute is drawn from the user and
 * the date, so every run of the day agrees on it.
 *
 * Odoo is read at each quarter hour (time off may have changed) and at the
 * next punch found then (next_punch_at); the other runs do nothing.
 *
 * It acts only at a planned time, and only when the user's state differs:
 * a check-out by hand stays until the next planned time. A punch that fails
 * is retried by the next runs, for 30 minutes.
 *
 * Each run also logs the timesheet routines due (timesheet_routines): a
 * line on an Odoo task every working day at a set time, 17:00 by default.
 * A day off (time off or public holiday over the whole schedule) is
 * skipped, and so is a task the user already logged time on that day.
 *
 * POST {}                                   the cron run
 * POST { "dryRun": true, "at"?: ISO time }  shows the day's plan, punches nothing
 *
 * Without the cron secret, a signed-in user (Authorization: Bearer) gets
 * their own day's plan, for the app: POST { "action": "PLAN" }.
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
  type Minute,
  type LeaveSpan,
  localMidnight,
  localMoment,
  parseClock,
  type Period,
  planPunches,
  type Punch,
  randomizePunches,
  remoteAtDayEnd,
  toLocalInterval,
  type WorkSchedule,
} from "../_shared/attendancePlan.ts"
import { getAdminClient, requireUserId } from "../_shared/auth.ts"
import { requireEnv } from "../_shared/env.ts"
import { HttpError } from "../_shared/errors.ts"
import { corsHeaders } from "../_shared/http.ts"
import {
  COUNTED_LEAVE_STATES,
  LEAVE_SPAN_FIELDS,
  readPublicHolidayRecords,
} from "../_shared/leaves.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import { readOdooDatetime, toOdooDatetime } from "../_shared/odooDates.ts"
import { getModelFields, optionalModelFields } from "../_shared/odooFields.ts"
import {
  CATCH_UP_MINUTES,
  nothingDue,
  outsideWorkingHours,
  routineDueOn,
} from "../_shared/autoAttendanceTiming.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import { isRecord } from "../_shared/validation.ts"

const TABLE = "auto_attendance_preferences"
const ROUTINES_TABLE = "timesheet_routines"
/** How long after its time a routine that couldn't be logged is retried. */
/** The day off check's schedule for users without automatic attendance. */
const DEFAULT_SCHEDULE: WorkSchedule = {
  morning: [9 * 60, 12 * 60 + 30],
  afternoon: [13 * 60 + 30, 17 * 60 + 30],
}
/** How long a planned punch that couldn't be made is retried. */

interface Preference {
  userId: string
  timezone: string
  schedule: WorkSchedule
  /** The check-out on a remote work afternoon; null to keep the schedule's. */
  remoteAfternoonEnd: Minute | null
  /** Each punch falls at a random minute up to this many after its time. */
  randomWindow: number
  /** The last planned punch handled, so it isn't made twice. */
  lastPunchAt: Date | null
  /** The next punch, as of the last Odoo read: when to read Odoo again. */
  nextPunchAt: Date | null
}

type Outcome =
  "idle" | "checked_in" | "checked_out" | "already_right" | "failed"

/** A request found on the day, and whether it takes time off. */
interface FoundLeave {
  type: string
  counted: boolean
}

interface DayPlan {
  date: string
  remote: boolean
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

function readTimestamp(value: unknown): Date | null {
  return typeof value === "string" ? new Date(value) : null
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
  const remoteEnd =
    typeof row.remote_afternoon_end === "string"
      ? parseClock(row.remote_afternoon_end)
      : null
  return {
    userId: row.user_id,
    timezone: row.timezone,
    schedule: { morning, afternoon },
    remoteAfternoonEnd:
      remoteEnd !== null && remoteEnd > afternoon[0] ? remoteEnd : null,
    randomWindow:
      typeof row.random_window_minutes === "number"
        ? Math.max(0, Math.floor(row.random_window_minutes))
        : 0,
    lastPunchAt: readTimestamp(row.last_punch_at),
    nextPunchAt: readTimestamp(row.next_punch_at),
  }
}

/** "HH:MM" of a minute of the day, for the dry run. */
function clock(minute: number): string {
  const rounded = Math.round(minute)
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`
}

/* ------------------------------------------------------------------ */
/* Odoo                                                                */
/* ------------------------------------------------------------------ */

/**
 * The first instance with the Attendances app and an employee for the user.
 *
 * An instance that fails (unreachable, expired certificate, wrong password)
 * is skipped: attendance often lives on another instance than the projects,
 * and the down one mustn't stop the punches. Its error is raised only when
 * no other instance qualifies, so a down attendance instance still reads as
 * a failure (retried by the next runs) and not as "no Attendances".
 */
async function findAttendanceInstance(
  userId: string
): Promise<{ session: OdooSession; employeeId: number }> {
  const instances = (await loadSettings(userId)).odooInstances
  const getSession = createSessionPool(instances)
  let failure: unknown = null
  for (const { index } of instances) {
    try {
      const session = await getSession(index)
      // "Object hr.attendance doesn't exist": the app isn't installed.
      if ((await optionalModelFields(session, "hr.attendance")) === null) {
        continue
      }
      const employeeId = await readOwnEmployeeId(session)
      if (employeeId !== null) return { session, employeeId }
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== null) throw failure
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
      isRecord(type) &&
      typeof type.id === "number" &&
      type.time_type === "other"
        ? [type.id]
        : []
    )
  )
}

/**
 * The user's pending or approved requests covering `date`: absences take
 * time off, worked time (remote work) can move the check-out.
 */
async function readLeaves(
  session: OdooSession,
  employeeId: number,
  date: string
): Promise<{
  spans: LeaveSpan[]
  workedSpans: LeaveSpan[]
  found: FoundLeave[]
}> {
  const available = await getModelFields(session, "hr.leave")
  const fields = LEAVE_SPAN_FIELDS.filter((field) => available.has(field))
  const records = await executeKw(
    session,
    "hr.leave",
    "search_read",
    [
      [
        ["employee_id", "=", employeeId],
        ["state", "in", COUNTED_LEAVE_STATES],
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
  const workedSpans: LeaveSpan[] = []
  const found: FoundLeave[] = []
  records.forEach((record, index) => {
    const type = types[index]
    const counted = type === null || !workedTime.has(type.id)
    found.push({ type: type?.name ?? "?", counted })
    const span = readLeaveSpan(record)
    if (span !== null) (counted ? spans : workedSpans).push(span)
  })
  return { spans, workedSpans, found }
}

/**
 * Public holidays of the day, of the user's working schedule, as local
 * intervals.
 */
async function readHolidays(
  session: OdooSession,
  dayStart: Date
): Promise<Interval[]> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
  const records = await readPublicHolidayRecords(session, [
    ["date_from", "<", toOdooDatetime(dayEnd)],
    ["date_to", ">", toOdooDatetime(dayStart)],
  ])
  return records.flatMap((record): Interval[] => {
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
  const remote =
    preference.remoteAfternoonEnd !== null &&
    remoteAtDayEnd(leaves.workedSpans, date, preference.schedule)
  const { morning, afternoon } = preference.schedule
  const schedule: WorkSchedule =
    remote && preference.remoteAfternoonEnd !== null
      ? { morning, afternoon: [afternoon[0], preference.remoteAfternoonEnd] }
      : preference.schedule
  return {
    date,
    remote,
    punches: randomizePunches(
      planPunches(schedule, off),
      preference.randomWindow,
      `${preference.userId}|${date}`
    ),
    leaves: leaves.found,
    holidays: holidays.length,
  }
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function savePunchTimes(
  userId: string,
  times: { last_punch_at?: string; next_punch_at: string | null }
): Promise<void> {
  const { error } = await getAdminClient()
    .from(TABLE)
    .update(times)
    .eq("user_id", userId)
  if (error !== null) {
    throw new HttpError(`Couldn't record the punch: ${error.message}`, 500)
  }
}

/**
 * Records the punch as taken before sending it, only if no other run did:
 * a run can outlast the one-minute schedule (slow Odoo), and the next one
 * would otherwise see the same punch due and toggle a second time.
 */
async function claimPunch(userId: string, at: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from(TABLE)
    .update({ last_punch_at: at })
    .eq("user_id", userId)
    .or(`last_punch_at.is.null,last_punch_at.lt."${at}"`)
    .select("user_id")
  if (error !== null) {
    throw new HttpError(`Couldn't record the punch: ${error.message}`, 500)
  }
  return Array.isArray(data) && data.length > 0
}

/** Gives a claimed punch back after a failure, unless a later one replaced it. */
async function releasePunch(
  userId: string,
  at: string,
  previous: Date | null
): Promise<void> {
  const { error } = await getAdminClient()
    .from(TABLE)
    .update({ last_punch_at: previous?.toISOString() ?? null })
    .eq("user_id", userId)
    .eq("last_punch_at", at)
  if (error !== null) {
    console.error(
      `auto-attendance: user ${userId}: release failed: ${error.message}`
    )
  }
}

async function punch(preference: Preference, now: Date): Promise<Outcome> {
  if (outsideWorkingHours(preference, now) || nothingDue(preference, now)) {
    return "idle"
  }
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
  const timed = plan.punches.map((planned) => ({
    ...planned,
    at: new Date(dayStart.getTime() + planned.minute * 60_000),
  }))
  const due = timed.filter(
    ({ at }) => at.getTime() > after && at.getTime() <= now.getTime()
  )
  const next =
    timed.find(({ at }) => at.getTime() > now.getTime())?.at.toISOString() ??
    null
  // Several due (a missed run): the latest one sets the state.
  const latest = due.at(-1)
  if (latest === undefined) {
    await savePunchTimes(preference.userId, { next_punch_at: next })
    return "idle"
  }

  const latestAt = latest.at.toISOString()
  if (!(await claimPunch(preference.userId, latestAt))) {
    // A run still busy with this punch claimed it: toggling here too would
    // undo its punch.
    return "idle"
  }
  let outcome: Outcome = "already_right"
  try {
    const isIn = (await readOpenAttendanceId(session, employeeId)) !== null
    if ((latest.action === "in") !== isIn) {
      await toggleAttendance(session, employeeId)
      outcome = latest.action === "in" ? "checked_in" : "checked_out"
    }
  } catch (error) {
    // Released so the next runs retry it, within the catch-up time.
    await releasePunch(preference.userId, latestAt, preference.lastPunchAt)
    throw error
  }

  await savePunchTimes(preference.userId, { next_punch_at: next })
  console.log(
    `auto-attendance: user ${preference.userId}: ${outcome} for ${clock(latest.minute)} (${plan.remote ? "remote, " : ""}${plan.leaves.filter((leave) => leave.counted).length} time off, ${plan.holidays} holidays)`
  )
  return outcome
}

/** The user's day as the cron sees it at `now`, without punching. */
async function describeDay(preference: Preference, now: Date) {
  const local = localMoment(now, preference.timezone)
  if (local === null) {
    throw new HttpError("Unknown time zone.", 400)
  }
  const { session, employeeId } = await findAttendanceInstance(
    preference.userId
  )
  const plan = await planDay(session, employeeId, preference, local.date)
  const isIn = (await readOpenAttendanceId(session, employeeId)) !== null
  return {
    instance: session.connection.label,
    date: plan.date,
    workingDay: local.weekday <= 5,
    timeOff: plan.leaves,
    holidays: plan.holidays,
    remote: plan.remote,
    checkedIn: isIn,
    punches: plan.punches.map(({ minute, action }) => ({
      time: clock(minute),
      action,
    })),
  }
}

/** The day's plan of each user, without punching. */
async function dryRun(preferences: Preference[], now: Date) {
  return await Promise.all(
    preferences.map(async (preference) => {
      try {
        const day = await describeDay(preference, now)
        return {
          userId: preference.userId,
          ...day,
          timeOff: day.timeOff.map(
            ({ type, counted }) =>
              `${type}${counted ? "" : " (worked time, ignored)"}`
          ),
          punches: day.punches.map(({ time, action }) => `${time} ${action}`),
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

/* ------------------------------------------------------------------ */
/* Timesheet routines                                                  */
/* ------------------------------------------------------------------ */

interface Routine {
  id: string
  userId: string
  instanceIndex: 1 | 2
  projectId: number
  taskId: number
  description: string
  hours: number
  logAt: Minute
  timezone: string
  lastLoggedOn: string | null
}

type RoutineOutcome = "logged" | "found" | "day_off" | "failed"

const ROUTINE_COLUMNS =
  "id, user_id, instance_index, project_id, task_id, description, hours, log_at, timezone, last_logged_on"

function readRoutine(row: unknown): Routine | null {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.user_id !== "string" ||
    (row.instance_index !== 1 && row.instance_index !== 2) ||
    typeof row.project_id !== "number" ||
    typeof row.task_id !== "number" ||
    typeof row.description !== "string" ||
    typeof row.log_at !== "string" ||
    typeof row.timezone !== "string"
  ) {
    return null
  }
  // numeric columns come back as numbers or strings.
  const hours = Number(row.hours)
  const logAt = parseClock(row.log_at.slice(0, 5))
  if (!Number.isFinite(hours) || hours <= 0 || logAt === null) return null
  return {
    id: row.id,
    userId: row.user_id,
    instanceIndex: row.instance_index,
    projectId: row.project_id,
    taskId: row.task_id,
    description: row.description,
    hours,
    logAt,
    timezone: row.timezone,
    lastLoggedOn:
      typeof row.last_logged_on === "string" ? row.last_logged_on : null,
  }
}

/**
 * True when the user doesn't work on `date`: time off and public holidays
 * leave no punch in their schedule. Without Attendances in Odoo, every
 * weekday is worked.
 */
async function isDayOff(
  userId: string,
  date: string,
  timezone: string,
  preferences: Map<string, Preference>
): Promise<boolean> {
  let found: { session: OdooSession; employeeId: number }
  try {
    found = await findAttendanceInstance(userId)
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) return false
    throw error
  }
  const preference: Preference = preferences.get(userId) ?? {
    userId,
    timezone,
    schedule: DEFAULT_SCHEDULE,
    remoteAfternoonEnd: null,
    randomWindow: 0,
    lastPunchAt: null,
    nextPunchAt: null,
  }
  const plan = await planDay(found.session, found.employeeId, preference, date)
  return plan.punches.length === 0
}

/**
 * Logs the routine's line on `date`, unless the user already logged time on
 * the task that day (by hand or by an earlier run): then it does nothing.
 */
async function logRoutine(
  session: OdooSession,
  routine: Routine,
  date: string
): Promise<"logged" | "found"> {
  const existing = await executeKw(
    session,
    "account.analytic.line",
    "search_count",
    [
      [
        ["task_id", "=", routine.taskId],
        ["date", "=", date],
        ["user_id", "=", session.uid],
      ],
    ]
  )
  if (typeof existing === "number" && existing > 0) return "found"
  await executeKw(session, "account.analytic.line", "create", [
    {
      name: routine.description,
      project_id: routine.projectId,
      task_id: routine.taskId,
      unit_amount: routine.hours,
      date,
    },
  ])
  return "logged"
}

async function markRoutines(ids: string[], date: string): Promise<void> {
  const { error } = await getAdminClient()
    .from(ROUTINES_TABLE)
    .update({ last_logged_on: date })
    .in("id", ids)
  if (error !== null) {
    throw new HttpError(`Couldn't record the routine: ${error.message}`, 500)
  }
}

/** One user's routines due on `date`. */
async function runUserRoutines(
  routines: Routine[],
  date: string,
  preferences: Map<string, Preference>
): Promise<RoutineOutcome[]> {
  const { userId, timezone } = routines[0]
  if (await isDayOff(userId, date, timezone, preferences)) {
    await markRoutines(
      routines.map((routine) => routine.id),
      date
    )
    console.log(`auto-attendance: user ${userId}: day off, no routine logged`)
    return routines.map(() => "day_off")
  }
  const getSession = createSessionPool(
    (await loadSettings(userId)).odooInstances
  )
  const outcomes: RoutineOutcome[] = []
  for (const routine of routines) {
    try {
      const outcome = await logRoutine(
        await getSession(routine.instanceIndex),
        routine,
        date
      )
      await markRoutines([routine.id], date)
      outcomes.push(outcome)
      console.log(
        `auto-attendance: user ${userId}: routine ${routine.id} ${outcome} on ${date}`
      )
    } catch (failure) {
      // Retried by the next runs, within the catch-up time.
      outcomes.push("failed")
      console.error(
        `auto-attendance: user ${userId}: routine ${routine.id}:`,
        failure instanceof Error ? failure.message : failure
      )
    }
  }
  return outcomes
}

/** Logs every routine due at `now`. */
async function runRoutines(
  now: Date,
  preferences: Preference[]
): Promise<Record<RoutineOutcome, number>> {
  const summary: Record<RoutineOutcome, number> = {
    logged: 0,
    found: 0,
    day_off: 0,
    failed: 0,
  }
  const { data, error } = await getAdminClient()
    .from(ROUTINES_TABLE)
    .select(ROUTINE_COLUMNS)
    .eq("enabled", true)
  if (error !== null) {
    throw new HttpError(`Couldn't read the routines: ${error.message}`, 500)
  }
  // Grouped by user and day: the day off check reads Odoo once for all.
  const due = new Map<string, { date: string; routines: Routine[] }>()
  for (const row of data ?? []) {
    const routine = readRoutine(row)
    const date = routine === null ? null : routineDueOn(routine, now)
    if (routine === null || date === null) continue
    const key = `${routine.userId}|${date}`
    const group = due.get(key) ?? { date, routines: [] }
    group.routines.push(routine)
    due.set(key, group)
  }
  const byUser = new Map(
    preferences.map((preference) => [preference.userId, preference])
  )
  for (const { date, routines } of due.values()) {
    try {
      for (const outcome of await runUserRoutines(routines, date, byUser)) {
        summary[outcome] += 1
      }
    } catch (failure) {
      summary.failed += routines.length
      console.error(
        `auto-attendance: user ${routines[0].userId}: routines:`,
        failure instanceof Error ? failure.message : failure
      )
    }
  }
  return summary
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  })
}

const PREFERENCE_COLUMNS =
  "user_id, enabled, timezone, morning_start, morning_end, afternoon_start, afternoon_end, remote_afternoon_end, random_window_minutes, last_punch_at, next_punch_at"

/** The signed-in user's own day, for the app: their settings, even when off. */
async function serveUser(request: Request): Promise<Response> {
  const headers = corsHeaders(request, "OPTIONS, POST")
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405, headers)
  }
  try {
    const userId = await requireUserId(request)
    const { data, error } = await getAdminClient()
      .from(TABLE)
      .select(PREFERENCE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle()
    if (error !== null) {
      throw new HttpError(
        `Couldn't read the preferences: ${error.message}`,
        500
      )
    }
    const preference = data === null ? null : readPreference(data)
    if (preference === null) {
      return json({ plan: null }, 200, headers)
    }
    return json(
      {
        plan: {
          ...(await describeDay(preference, new Date())),
          nextPunchAt: preference.nextPunchAt?.toISOString() ?? null,
        },
      },
      200,
      headers
    )
  } catch (failure) {
    if (failure instanceof HttpError) {
      return json({ error: failure.message }, failure.status, headers)
    }
    console.error("auto-attendance: unexpected error", failure)
    return json({ error: "Unexpected server error." }, 500, headers)
  }
}

Deno.serve(async (request) => {
  // The app: a signed-in user, no cron secret.
  if (!request.headers.has("x-cron-secret")) {
    return await serveUser(request)
  }
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
      .select(PREFERENCE_COLUMNS)
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
    let routines: Record<RoutineOutcome, number> | { error: string }
    try {
      routines = await runRoutines(now, preferences)
    } catch (failure) {
      routines = {
        error: failure instanceof Error ? failure.message : String(failure),
      }
    }
    return json({ ...summary, routines })
  } catch (failure) {
    if (failure instanceof HttpError) {
      return json({ error: failure.message }, failure.status)
    }
    console.error("auto-attendance: unexpected error", failure)
    return json({ error: "Unexpected server error." }, 500)
  }
})
