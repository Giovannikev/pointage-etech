/**
 * daily-reminder — Supabase Edge Function (Deno)
 *
 * Called by pg_cron every 15 minutes (supabase/cron/daily-reminder.sql),
 * never by browsers: deploy it with JWT verification off and protect it with
 * the CRON_SECRET header.
 *
 * For each user with the reminder on, once per working day after their local
 * reminder hour, it sums the time they logged today in their Odoo instances
 * and emails them (through Resend) when it is below a full day.
 *
 * Secrets: CRON_SECRET, RESEND_API_KEY, REMINDER_FROM_EMAIL, APP_URL
 * (plus SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIALS_ENCRYPTION_KEY).
 */
import { getAdminClient } from "../_shared/auth.ts"
import { readEnv, requireEnv } from "../_shared/env.ts"
import { HttpError } from "../_shared/errors.ts"
import { createSessionPool, executeKw } from "../_shared/odoo.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import { isRecord } from "../_shared/validation.ts"

const TABLE = "reminder_preferences"
const WORKDAY_HOURS = 8
const TIMESHEET_LIMIT = 500
const RESEND_URL = "https://api.resend.com/emails"

type Language = "fr" | "en"

interface ReminderPreference {
  userId: string
  remindHour: number
  timezone: string
  language: Language
  lastCheckedOn: string | null
}

interface LocalTime {
  /** YYYY-MM-DD in the user's time zone. */
  date: string
  hour: number
  /** 1 (Monday) to 7 (Sunday). */
  weekday: number
}

type Outcome = "skipped" | "complete" | "reminded" | "failed"

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

const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

/** The user's local date, hour and weekday; null for an unknown time zone. */
function localTime(now: Date, timezone: string): LocalTime | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now)
  } catch {
    return null
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ""
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    weekday: WEEKDAYS[part("weekday")] ?? 0,
  }
}

function readPreference(row: unknown): ReminderPreference | null {
  if (
    !isRecord(row) ||
    typeof row.user_id !== "string" ||
    typeof row.remind_hour !== "number" ||
    typeof row.timezone !== "string"
  ) {
    return null
  }
  return {
    userId: row.user_id,
    remindHour: row.remind_hour,
    timezone: row.timezone,
    language: row.language === "en" ? "en" : "fr",
    lastCheckedOn:
      typeof row.last_checked_on === "string" ? row.last_checked_on : null,
  }
}

/* ------------------------------------------------------------------ */
/* Odoo                                                                */
/* ------------------------------------------------------------------ */

/**
 * Hours the user logged on the day across their instances. Throws when an
 * instance can't be read: better no email than a wrong one.
 */
async function loggedHoursOn(userId: string, date: string): Promise<number> {
  const instances = (await loadSettings(userId)).odooInstances
  if (instances.length === 0) {
    throw new HttpError("No Odoo instance configured.", 400)
  }
  const getSession = createSessionPool(instances)
  const totals = await Promise.all(
    instances.map(async ({ index }) => {
      const session = await getSession(index)
      const records = await executeKw(
        session,
        "account.analytic.line",
        "search_read",
        [
          [
            ["user_id", "=", session.uid],
            ["project_id", "!=", false],
            ["date", "=", date],
          ],
        ],
        { fields: ["unit_amount"], limit: TIMESHEET_LIMIT }
      )
      if (!Array.isArray(records)) {
        throw new HttpError(`${session.connection.label} answered badly.`, 502)
      }
      return records.reduce(
        (sum: number, record) =>
          sum +
          (isRecord(record) && typeof record.unit_amount === "number"
            ? record.unit_amount
            : 0),
        0
      )
    })
  )
  return Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100
}

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */

function formatHours(hours: number, language: Language): string {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(hours)} h`
}

function buildEmail(
  language: Language,
  logged: number,
  appUrl: string | null
): { subject: string; html: string; text: string } {
  const missing = formatHours(WORKDAY_HOURS - logged, language)
  const done = formatHours(logged, language)
  const link = appUrl === null ? null : `${appUrl.replace(/\/$/, "")}/#history`
  if (language === "en") {
    const text = `You've logged ${done} in Odoo today: ${missing} short of a full day.`
    return {
      subject: `Pointage: ${missing} left to log today`,
      text: link === null ? text : `${text}\n\nOpen Pointage: ${link}`,
      html: `<p>${text}</p>${link === null ? "" : `<p><a href="${link}">Open Pointage</a></p>`}`,
    }
  }
  const text = `Vous avez pointé ${done} dans Odoo aujourd'hui : il manque ${missing} pour une journée complète.`
  return {
    subject: `Pointage : il vous reste ${missing} à pointer aujourd'hui`,
    text: link === null ? text : `${text}\n\nOuvrir Pointage : ${link}`,
    html: `<p>${text}</p>${link === null ? "" : `<p><a href="${link}">Ouvrir Pointage</a></p>`}`,
  }
}

async function sendReminder(
  to: string,
  language: Language,
  logged: number
): Promise<void> {
  const email = buildEmail(language, logged, readEnv("APP_URL"))
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requireEnv("REMINDER_FROM_EMAIL"),
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new HttpError(
      `Resend refused the email (HTTP ${response.status}) ${detail}`,
      502
    )
  }
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function remind(
  preference: ReminderPreference,
  now: Date
): Promise<Outcome> {
  const local = localTime(now, preference.timezone)
  if (
    local === null ||
    local.weekday > 5 ||
    local.hour < preference.remindHour ||
    preference.lastCheckedOn === local.date
  ) {
    return "skipped"
  }

  const admin = getAdminClient()
  const logged = await loggedHoursOn(preference.userId, local.date)
  let outcome: Outcome = "complete"
  if (logged < WORKDAY_HOURS) {
    const { data, error } = await admin.auth.admin.getUserById(
      preference.userId
    )
    const address = data.user?.email
    if (error !== null || address === undefined) {
      throw new HttpError("The user's email can't be read.", 500)
    }
    await sendReminder(address, preference.language, logged)
    outcome = "reminded"
  }

  // Checked for today: no second email, even if the day stays short.
  const { error } = await admin
    .from(TABLE)
    .update({ last_checked_on: local.date })
    .eq("user_id", preference.userId)
  if (error !== null) {
    throw new HttpError(`Couldn't record the check: ${error.message}`, 500)
  }
  return outcome
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

    const { data, error } = await getAdminClient()
      .from(TABLE)
      .select("user_id, remind_hour, timezone, language, last_checked_on")
      .eq("enabled", true)
    if (error !== null) {
      throw new HttpError(
        `Couldn't read the preferences: ${error.message}`,
        500
      )
    }

    const now = new Date()
    const summary: Record<Outcome, number> = {
      skipped: 0,
      complete: 0,
      reminded: 0,
      failed: 0,
    }
    // One user at a time: a slow or failing Odoo only delays the others.
    for (const preference of (data ?? []).flatMap(
      (row) => readPreference(row) ?? []
    )) {
      try {
        summary[await remind(preference, now)] += 1
      } catch (failure) {
        summary.failed += 1
        console.error(
          `daily-reminder: user ${preference.userId}:`,
          failure instanceof Error ? failure.message : failure
        )
      }
    }
    return json(summary)
  } catch (failure) {
    if (failure instanceof HttpError) {
      return json({ error: failure.message }, failure.status)
    }
    console.error("daily-reminder: unexpected error", failure)
    return json({ error: "Unexpected server error." }, 500)
  }
})
