// @ts-nocheck -- single-file build of supabase/functions/daily-reminder (esbuild); edit the sources, not this file.
// _shared/auth.ts
import { createClient } from "npm:@supabase/supabase-js@2"

// _shared/errors.ts
var HttpError = class extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
    this.name = "HttpError"
  }
}

// _shared/env.ts
function readEnv(name) {
  const value = Deno.env.get(name)?.trim()
  return value === void 0 || value === "" ? null : value
}
function requireEnv(name) {
  const value = readEnv(name)
  if (value === null) {
    throw new HttpError(`Server misconfigured: ${name} is not set.`, 500)
  }
  return value
}

// _shared/auth.ts
var adminClient = null
function getAdminClient() {
  adminClient ??= createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  )
  return adminClient
}

// _shared/validation.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}
function isNonEmptyString(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength
  )
}

// _shared/odoo.ts
var RPC_TIMEOUT_MS = 2e4
var OdooRpcError = class extends HttpError {
  constructor(message) {
    super(message, 502)
    this.name = "OdooRpcError"
  }
}
var rpcRequestId = 0
function readOdooErrorMessage(error) {
  if (isRecord(error)) {
    if (isRecord(error.data) && typeof error.data.message === "string") {
      return error.data.message
    }
    if (typeof error.message === "string") {
      return error.message
    }
  }
  return "Odoo returned an unknown error."
}
async function postJsonRpc(url, label, params) {
  rpcRequestId += 1
  let response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params,
        id: rpcRequestId,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new HttpError(`${label} is unreachable (${reason}).`, 502)
  }
  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get("Location") ?? "another address"
    throw new HttpError(
      `${label} redirects to ${target}. Use that URL in Settings.`,
      502
    )
  }
  if (!response.ok) {
    throw new HttpError(`${label} responded with HTTP ${response.status}.`, 502)
  }
  const payload = await response.json().catch(() => null)
  if (!isRecord(payload)) {
    throw new HttpError(`${label} returned an invalid JSON-RPC payload.`, 502)
  }
  if (payload.error !== void 0) {
    throw new OdooRpcError(readOdooErrorMessage(payload.error))
  }
  return payload.result
}
function callService(connection, service, method, args) {
  return postJsonRpc(`${connection.url}/jsonrpc`, connection.label, {
    service,
    method,
    args,
  })
}
async function authenticate(connection) {
  let uid
  try {
    uid = await callService(connection, "common", "authenticate", [
      connection.db,
      connection.login,
      connection.apiKey,
      {},
    ])
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new OdooRpcError(
        `Authentication failed on ${connection.label}: ${error.message}`
      )
    }
    throw error
  }
  if (!isPositiveInteger(uid)) {
    throw new OdooRpcError(
      `Authentication failed on ${connection.label}. Check the database, login and API key.`
    )
  }
  return { connection, uid }
}
function executeKw(session, model, method, args, kwargs = {}) {
  const { connection, uid } = session
  return callService(connection, "object", "execute_kw", [
    connection.db,
    uid,
    connection.apiKey,
    model,
    method,
    args,
    kwargs,
  ])
}
function createSessionPool(instances) {
  const sessions = /* @__PURE__ */ new Map()
  return (index) => {
    let session = sessions.get(index)
    if (session === void 0) {
      const instance = instances.find((candidate) => candidate.index === index)
      session =
        instance === void 0
          ? Promise.reject(
              new HttpError(`Odoo instance ${index} is not configured.`, 400)
            )
          : authenticate(instance)
      sessions.set(index, session)
    }
    return session
  }
}

// _shared/crypto.ts
var KEY_ENV = "CREDENTIALS_ENCRYPTION_KEY"
var KEY_LENGTH = 32
var FORMAT_VERSION = "v1"
var encoder = new TextEncoder()
var decoder = new TextDecoder()
function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}
function decodeKey(encoded) {
  try {
    return fromBase64(encoded)
  } catch {
    return null
  }
}
function importKey() {
  const raw = decodeKey(requireEnv(KEY_ENV))
  if (raw === null || raw.length !== KEY_LENGTH) {
    throw new HttpError(
      `Server misconfigured: ${KEY_ENV} must be ${KEY_LENGTH} bytes encoded in base64.`,
      500
    )
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}
async function decryptText(payload, associatedData) {
  const [version, iv, cipher] = payload.split(".")
  if (version !== FORMAT_VERSION || iv === void 0 || cipher === void 0) {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    )
  }
  const key = await importKey()
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(iv),
        additionalData: encoder.encode(associatedData),
      },
      key,
      fromBase64(cipher)
    )
    return decoder.decode(plain)
  } catch {
    throw new HttpError(
      "Your stored settings can't be decrypted. Save them again.",
      500
    )
  }
}

// _shared/settings.ts
var MAX_LABEL_LENGTH = 60
var MAX_FIELD_LENGTH = 255
var MAX_DB_LENGTH = 63
var MAX_AUTHOR_EMAILS = 10
var EMPTY_SETTINGS = { github: null, odooInstances: [] }
function isInstanceIndex(value) {
  return value === 1 || value === 2
}
function isEmailList(value) {
  return (
    Array.isArray(value) &&
    value.length <= MAX_AUTHOR_EMAILS &&
    value.every(
      (email) =>
        isNonEmptyString(email, MAX_FIELD_LENGTH) && email.includes("@")
    )
  )
}
function normalizeOdooUrl(value) {
  if (typeof value !== "string") {
    return null
  }
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null
  } catch {
    return null
  }
}
function parseInstanceFields(value) {
  if (!isRecord(value)) {
    return null
  }
  const url = normalizeOdooUrl(value.url)
  if (
    !isInstanceIndex(value.index) ||
    !isNonEmptyString(value.label, MAX_LABEL_LENGTH) ||
    url === null ||
    typeof value.db !== "string" ||
    value.db.length > MAX_DB_LENGTH ||
    !isNonEmptyString(value.login, MAX_FIELD_LENGTH)
  ) {
    return null
  }
  return {
    index: value.index,
    label: value.label.trim(),
    url,
    db: value.db.trim(),
    login: value.login.trim(),
  }
}
function hasUniqueIndexes(instances) {
  return (
    new Set(instances.map((instance) => instance.index)).size ===
    instances.length
  )
}
function parseStoredSettings(value) {
  const invalid = new HttpError(
    "Your stored settings are invalid. Save them again.",
    500
  )
  if (!isRecord(value) || !Array.isArray(value.odooInstances)) {
    throw invalid
  }
  let github = null
  if (value.github !== null) {
    const stored = value.github
    if (
      !isRecord(stored) ||
      !isNonEmptyString(stored.token, MAX_FIELD_LENGTH) ||
      !isNonEmptyString(stored.login, MAX_FIELD_LENGTH) ||
      !isNonEmptyString(stored.nodeId, MAX_FIELD_LENGTH) ||
      !isEmailList(stored.authorEmails)
    ) {
      throw invalid
    }
    github = {
      token: stored.token,
      login: stored.login,
      nodeId: stored.nodeId,
      authorEmails: stored.authorEmails,
    }
  }
  const odooInstances = value.odooInstances.map((stored) => {
    const fields = parseInstanceFields(stored)
    if (
      fields === null ||
      !isRecord(stored) ||
      !isNonEmptyString(stored.apiKey, MAX_FIELD_LENGTH)
    ) {
      throw invalid
    }
    return { ...fields, apiKey: stored.apiKey }
  })
  if (!hasUniqueIndexes(odooInstances)) {
    throw invalid
  }
  return { github, odooInstances }
}

// _shared/settingsStore.ts
var TABLE = "user_settings"
async function loadSettings(userId) {
  const { data, error } = await getAdminClient()
    .from(TABLE)
    .select("payload")
    .eq("user_id", userId)
    .maybeSingle()
  if (error !== null) {
    throw new HttpError(`Couldn't load your settings: ${error.message}`, 500)
  }
  if (data === null) {
    return EMPTY_SETTINGS
  }
  if (!isRecord(data) || typeof data.payload !== "string") {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    )
  }
  const plainText = await decryptText(data.payload, userId)
  return parseStoredSettings(JSON.parse(plainText))
}

// daily-reminder/index.ts
var TABLE2 = "reminder_preferences"
var WORKDAY_HOURS = 8
var TIMESHEET_LIMIT = 500
var RESEND_URL = "https://api.resend.com/emails"
function safeEqual(a, b) {
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
var WEEKDAYS = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}
function localTime(now, timezone) {
  let parts
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
  const part = (type) => parts.find((item) => item.type === type)?.value ?? ""
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    weekday: WEEKDAYS[part("weekday")] ?? 0,
  }
}
function readPreference(row) {
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
async function loggedHoursOn(userId, date) {
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
        (sum, record) =>
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
function formatHours(hours, language) {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(hours)} h`
}
function buildEmail(language, logged, appUrl) {
  const missing = formatHours(WORKDAY_HOURS - logged, language)
  const done = formatHours(logged, language)
  const link = appUrl === null ? null : `${appUrl.replace(/\/$/, "")}/#history`
  if (language === "en") {
    const text2 = `You've logged ${done} in Odoo today: ${missing} short of a full day.`
    return {
      subject: `Pointage: ${missing} left to log today`,
      text:
        link === null
          ? text2
          : `${text2}

Open Pointage: ${link}`,
      html: `<p>${text2}</p>${link === null ? "" : `<p><a href="${link}">Open Pointage</a></p>`}`,
    }
  }
  const text = `Vous avez point\xE9 ${done} dans Odoo aujourd'hui : il manque ${missing} pour une journ\xE9e compl\xE8te.`
  return {
    subject: `Pointage : il vous reste ${missing} \xE0 pointer aujourd'hui`,
    text:
      link === null
        ? text
        : `${text}

Ouvrir Pointage : ${link}`,
    html: `<p>${text}</p>${link === null ? "" : `<p><a href="${link}">Ouvrir Pointage</a></p>`}`,
  }
}
async function sendReminder(to, language, logged) {
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
    signal: AbortSignal.timeout(15e3),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new HttpError(
      `Resend refused the email (HTTP ${response.status}) ${detail}`,
      502
    )
  }
}
async function remind(preference, now) {
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
  let outcome = "complete"
  if (logged < WORKDAY_HOURS) {
    const { data, error: error2 } = await admin.auth.admin.getUserById(
      preference.userId
    )
    const address = data.user?.email
    if (error2 !== null || address === void 0) {
      throw new HttpError("The user's email can't be read.", 500)
    }
    await sendReminder(address, preference.language, logged)
    outcome = "reminded"
  }
  const { error } = await admin
    .from(TABLE2)
    .update({ last_checked_on: local.date })
    .eq("user_id", preference.userId)
  if (error !== null) {
    throw new HttpError(`Couldn't record the check: ${error.message}`, 500)
  }
  return outcome
}
function json(body, status = 200) {
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
      .from(TABLE2)
      .select("user_id, remind_hour, timezone, language, last_checked_on")
      .eq("enabled", true)
    if (error !== null) {
      throw new HttpError(
        `Couldn't read the preferences: ${error.message}`,
        500
      )
    }
    const now = /* @__PURE__ */ new Date()
    const summary = {
      skipped: 0,
      complete: 0,
      reminded: 0,
      failed: 0,
    }
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
