/**
 * odoo-gateway — Supabase Edge Function (Deno)
 *
 * Bridges the dashboard to the signed-in user's Odoo instances through
 * Odoo's JSON-RPC API, with the credentials stored in their settings.
 *
 * Actions (POST body):
 *   { action: "SEARCH_TASK", taskRefs: string[] }
 *   { action: "SUBMIT_TIMESHEET", entries: TimesheetSubmission[] }
 *   { action: "FIND_TIMESHEETS", lookups: TimesheetLookup[] }
 *   { action: "GET_TASK", instanceIndex, taskId }
 *   { action: "GET_MY_TASKS", instanceIndex? }
 *   { action: "GET_TIMESHEET_HISTORY", dateFrom, dateTo, instanceIndex? }
 *   { action: "UPDATE_TIMESHEET", instanceIndex, timesheetId, hours, description }
 *   { action: "DELETE_TIMESHEET", instanceIndex, timesheetId }
 *   { action: "SEARCH_TASKS", query, instanceIndex? }
 *   { action: "SEARCH_TICKETS", query, mine, instanceIndex? }
 *   { action: "LOG_TICKET_TIME", instanceIndex, ticketId, hours, description, date }
 */
import { HttpError } from "../_shared/errors.ts"
import { readJsonBody, serveJson } from "../_shared/http.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import {
  INSTANCE_INDEXES,
  type InstanceIndex,
  type OdooInstanceSettings,
  requireOdooInstances,
} from "../_shared/settings.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import {
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from "../_shared/validation.ts"

/* ------------------------------------------------------------------ */
/* Contract — mirrors src/types/timesheet.ts                           */
/* ------------------------------------------------------------------ */

interface TaskMatch {
  taskId: number
  taskName: string
  projectId: number
  projectName: string
  instanceIndex: InstanceIndex
}

type TaskSearchResult =
  | ({ taskRef: string; found: true } & TaskMatch)
  | { taskRef: string; found: false }

interface TimesheetSubmission {
  clientId: string
  taskId: number
  projectId: number
  hours: number
  description: string
  date: string
  instanceIndex: InstanceIndex
}

type SubmissionResult =
  | { clientId: string; success: true; timesheetId: number }
  | { clientId: string; success: false; error: string }

interface TimesheetLookup {
  instanceIndex: InstanceIndex
  taskId: number
  date: string
}

interface LoggedTimesheet extends TimesheetLookup {
  timesheetId: number
  hours: number
  description: string
  /** Validated in Odoo (Timesheets app): it can't be changed anymore. */
  locked: boolean
}

interface TaskReference {
  instanceIndex: InstanceIndex
  taskId: number
}

interface TaskDetails {
  taskId: number
  name: string
  /** The task description as stored by Odoo; the dashboard sanitizes it. */
  descriptionHtml: string
  projectName: string | null
  stageName: string | null
}

/** Task state, normalized across Odoo versions (kanban_state up to 16, state from 17). */
type KanbanTaskStatus =
  | "in_progress"
  | "changes_requested"
  | "approved"
  | "done"
  | "canceled"
  | "waiting"
  | "blocked"

interface KanbanTask {
  instanceIndex: InstanceIndex
  taskId: number
  name: string
  projectId: number | null
  projectName: string | null
  stageId: number | null
  stageName: string | null
  /** 0 is normal; 1 and more are starred. */
  priority: number
  /**
   * "YYYY-MM-DD" when the field is a date (Odoo 16 and older), or an ISO UTC
   * timestamp ("2026-10-14T21:00:00Z") when it is a datetime (Odoo 17+): the
   * browser turns it into a local day.
   */
  deadline: string | null
  status: KanbanTaskStatus | null
  /** null when the instance has no planned hours field or none are set. */
  plannedHours: number | null
  /** null when timesheets aren't installed on the instance. */
  effectiveHours: number | null
}

interface KanbanStage {
  instanceIndex: InstanceIndex
  stageId: number
  name: string
  sequence: number
  folded: boolean
}

interface TimesheetHistoryEntry {
  instanceIndex: InstanceIndex
  timesheetId: number
  /** YYYY-MM-DD */
  date: string
  description: string
  hours: number
  projectId: number | null
  projectName: string | null
  taskId: number | null
  taskName: string | null
  /** Set for time logged on a helpdesk ticket. */
  ticketId: number | null
  ticketName: string | null
  /** Validated in Odoo (Timesheets app): it can't be changed anymore. */
  locked: boolean
}

/** A helpdesk ticket, as listed in the Tasks page. */
interface HelpdeskTicket {
  instanceIndex: InstanceIndex
  ticketId: number
  name: string
  /** The ticket's reference when the instance has one (e.g. "HT10605"). */
  ref: string | null
  stageName: string | null
  teamName: string | null
  priority: number
  projectId: number | null
  projectName: string | null
  /** null when the instance doesn't track time on tickets. */
  hoursSpent: number | null
  /** Time can be logged: timesheets on tickets are on and it has a project. */
  loggable: boolean
}

interface TicketQuery {
  query: string
  /** Only the user's open tickets (the query then filters nothing server side). */
  mine: boolean
  instanceIndex: InstanceIndex | null
}

interface TicketTimeEntry {
  instanceIndex: InstanceIndex
  ticketId: number
  hours: number
  description: string
  date: string
}

/** One result per instance, so a failing instance doesn't hide the other one. */
type InstanceResult<T> =
  | ({ instanceIndex: InstanceIndex; ok: true } & T)
  | { instanceIndex: InstanceIndex; ok: false; error: string }

type MyTasksResult = InstanceResult<{
  tasks: KanbanTask[]
  stages: KanbanStage[]
  /** True when the task limit was reached and older tasks were left out. */
  truncated: boolean
}>

type TaskSearchInstanceResult = InstanceResult<{
  tasks: KanbanTask[]
  truncated: boolean
}>

type TicketsInstanceResult = InstanceResult<{
  /** False when the Helpdesk app isn't installed on the instance. */
  available: boolean
  tickets: HelpdeskTicket[]
  truncated: boolean
}>

type TimesheetHistoryResult = InstanceResult<{
  entries: TimesheetHistoryEntry[]
  truncated: boolean
}>

interface TimesheetReference {
  instanceIndex: InstanceIndex
  timesheetId: number
}

interface TimesheetUpdate extends TimesheetReference {
  hours: number
  description: string
}

interface HistoryQuery {
  dateFrom: string
  dateTo: string
  instanceIndex: InstanceIndex | null
}

type GatewayRequest =
  | { action: "SEARCH_TASK"; taskRefs: string[] }
  | { action: "SUBMIT_TIMESHEET"; entries: TimesheetSubmission[] }
  | { action: "FIND_TIMESHEETS"; lookups: TimesheetLookup[] }
  | ({ action: "GET_TASK" } & TaskReference)
  | { action: "GET_MY_TASKS"; instanceIndex: InstanceIndex | null }
  | ({ action: "GET_TIMESHEET_HISTORY" } & HistoryQuery)
  | ({ action: "UPDATE_TIMESHEET" } & TimesheetUpdate)
  | ({ action: "DELETE_TIMESHEET" } & TimesheetReference)
  | {
      action: "SEARCH_TASKS"
      query: string
      instanceIndex: InstanceIndex | null
    }
  | ({ action: "SEARCH_TICKETS" } & TicketQuery)
  | ({ action: "LOG_TICKET_TIME" } & TicketTimeEntry)

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

const MAX_ITEMS_PER_REQUEST = 100
/** A month of commits can touch more task and day pairs than a submission. */
const MAX_LOOKUPS_PER_REQUEST = 500
const TIMESHEET_LOOKUP_LIMIT = 2_000
const MAX_TASK_REF_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 2_000
const TASK_CANDIDATE_LIMIT = 20
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MY_TASKS_LIMIT = 1_000
const HISTORY_LIMIT = 2_000
const MAX_HISTORY_DAYS = 366
const SEARCH_LIMIT = 50
const MY_TICKETS_LIMIT = 200
const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 100
const MS_PER_DAY = 86_400_000

function isInstanceIndex(value: unknown): value is InstanceIndex {
  return value === 1 || value === 2
}

function readBatch(
  value: unknown,
  field: string,
  maxItems = MAX_ITEMS_PER_REQUEST
): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new HttpError(
      `"${field}" must be a non-empty array of at most ${maxItems} items.`,
      400
    )
  }
  return value
}

function parseLookup(value: unknown, position: number): TimesheetLookup {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.taskId) &&
    typeof value.date === "string" &&
    ISO_DATE.test(value.date)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      taskId: value.taskId,
      date: value.date,
    }
  }
  throw new HttpError(`Lookup ${position + 1} is invalid.`, 400)
}

function parseSubmission(
  value: unknown,
  position: number
): TimesheetSubmission {
  if (
    isRecord(value) &&
    isNonEmptyString(value.clientId, 100) &&
    isPositiveInteger(value.taskId) &&
    isPositiveInteger(value.projectId) &&
    typeof value.hours === "number" &&
    value.hours > 0 &&
    value.hours <= 24 &&
    isNonEmptyString(value.description, MAX_DESCRIPTION_LENGTH) &&
    typeof value.date === "string" &&
    ISO_DATE.test(value.date) &&
    isInstanceIndex(value.instanceIndex)
  ) {
    return {
      clientId: value.clientId,
      taskId: value.taskId,
      projectId: value.projectId,
      hours: value.hours,
      description: value.description.trim(),
      date: value.date,
      instanceIndex: value.instanceIndex,
    }
  }
  throw new HttpError(`Entry ${position + 1} is invalid.`, 400)
}

function isValidHours(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 24
  )
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

/** An omitted instance index means every configured instance. */
function readOptionalInstance(value: unknown): InstanceIndex | null {
  if (value === undefined || value === null) {
    return null
  }
  if (isInstanceIndex(value)) {
    return value
  }
  throw new HttpError('"instanceIndex" must be 1 or 2 when given.', 400)
}

function parseTimesheetReference(
  body: Record<string, unknown>
): TimesheetReference {
  if (
    !isInstanceIndex(body.instanceIndex) ||
    !isPositiveInteger(body.timesheetId)
  ) {
    throw new HttpError('"instanceIndex" and "timesheetId" are required.', 400)
  }
  return { instanceIndex: body.instanceIndex, timesheetId: body.timesheetId }
}

function parseHistoryQuery(body: Record<string, unknown>): HistoryQuery {
  const { dateFrom, dateTo } = body
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
    throw new HttpError(
      '"dateFrom" and "dateTo" must be dates (YYYY-MM-DD).',
      400
    )
  }
  const days =
    (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) /
      MS_PER_DAY +
    1
  if (days < 1 || days > MAX_HISTORY_DAYS) {
    throw new HttpError(
      `The period must run forward and last at most ${MAX_HISTORY_DAYS} days.`,
      400
    )
  }
  return {
    dateFrom,
    dateTo,
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

/** A search text of 2 to 100 characters; empty is allowed when `optional`. */
function readQuery(value: unknown, optional: boolean): string {
  const query = typeof value === "string" ? value.trim() : ""
  if (optional && query === "") {
    return ""
  }
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    throw new HttpError(
      `"query" must be ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters.`,
      400
    )
  }
  return query
}

function parseRequest(body: unknown): GatewayRequest {
  if (!isRecord(body)) {
    throw new HttpError("Request body must be a JSON object.", 400)
  }

  if (body.action === "SEARCH_TASK") {
    const taskRefs = readBatch(body.taskRefs, "taskRefs").map((ref) => {
      if (!isNonEmptyString(ref, MAX_TASK_REF_LENGTH)) {
        throw new HttpError("Every task reference must be a short string.", 400)
      }
      return ref.trim()
    })
    return { action: "SEARCH_TASK", taskRefs: [...new Set(taskRefs)] }
  }

  if (body.action === "SUBMIT_TIMESHEET") {
    const entries = readBatch(body.entries, "entries").map(parseSubmission)
    return { action: "SUBMIT_TIMESHEET", entries }
  }

  if (body.action === "GET_TASK") {
    if (
      !isInstanceIndex(body.instanceIndex) ||
      !isPositiveInteger(body.taskId)
    ) {
      throw new HttpError('"instanceIndex" and "taskId" are required.', 400)
    }
    return {
      action: "GET_TASK",
      instanceIndex: body.instanceIndex,
      taskId: body.taskId,
    }
  }

  if (body.action === "FIND_TIMESHEETS") {
    const lookups = readBatch(
      body.lookups,
      "lookups",
      MAX_LOOKUPS_PER_REQUEST
    ).map(parseLookup)
    return { action: "FIND_TIMESHEETS", lookups }
  }

  if (body.action === "GET_MY_TASKS") {
    return {
      action: "GET_MY_TASKS",
      instanceIndex: readOptionalInstance(body.instanceIndex),
    }
  }

  if (body.action === "GET_TIMESHEET_HISTORY") {
    return { action: "GET_TIMESHEET_HISTORY", ...parseHistoryQuery(body) }
  }

  if (body.action === "UPDATE_TIMESHEET") {
    const reference = parseTimesheetReference(body)
    if (!isValidHours(body.hours)) {
      throw new HttpError('"hours" must be between 0 and 24.', 400)
    }
    if (!isNonEmptyString(body.description, MAX_DESCRIPTION_LENGTH)) {
      throw new HttpError(
        `"description" must be a non-empty text of at most ${MAX_DESCRIPTION_LENGTH} characters.`,
        400
      )
    }
    return {
      action: "UPDATE_TIMESHEET",
      ...reference,
      hours: body.hours,
      description: body.description.trim(),
    }
  }

  if (body.action === "DELETE_TIMESHEET") {
    return { action: "DELETE_TIMESHEET", ...parseTimesheetReference(body) }
  }

  if (body.action === "SEARCH_TASKS") {
    return {
      action: "SEARCH_TASKS",
      query: readQuery(body.query, false),
      instanceIndex: readOptionalInstance(body.instanceIndex),
    }
  }

  if (body.action === "SEARCH_TICKETS") {
    const mine = body.mine === true
    return {
      action: "SEARCH_TICKETS",
      mine,
      query: readQuery(body.query, mine),
      instanceIndex: readOptionalInstance(body.instanceIndex),
    }
  }

  if (body.action === "LOG_TICKET_TIME") {
    if (
      !isInstanceIndex(body.instanceIndex) ||
      !isPositiveInteger(body.ticketId) ||
      !isValidHours(body.hours) ||
      !isNonEmptyString(body.description, MAX_DESCRIPTION_LENGTH) ||
      !isIsoDate(body.date)
    ) {
      throw new HttpError(
        '"instanceIndex", "ticketId", "hours", "description" and "date" are required.',
        400
      )
    }
    return {
      action: "LOG_TICKET_TIME",
      instanceIndex: body.instanceIndex,
      ticketId: body.ticketId,
      hours: body.hours,
      description: body.description.trim(),
      date: body.date,
    }
  }

  throw new HttpError(
    'Unknown action. Use "SEARCH_TASK", "SUBMIT_TIMESHEET", "FIND_TIMESHEETS", "GET_TASK", "GET_MY_TASKS", "GET_TIMESHEET_HISTORY", "UPDATE_TIMESHEET", "DELETE_TIMESHEET", "SEARCH_TASKS", "SEARCH_TICKETS" or "LOG_TICKET_TIME".',
    400
  )
}

/* ------------------------------------------------------------------ */
/* Model fields, cached per database                                   */
/* ------------------------------------------------------------------ */

const FIELDS_CACHE_TTL_MS = 10 * 60_000
/** Survives between requests while the function instance stays warm. */
const fieldsCache = new Map<
  string,
  { fields: Set<string>; expiresAt: number }
>()

/**
 * The fields a model has on the session's database. Field lists differ
 * between Odoo versions and installed apps, and asking search_read for a
 * missing field fails, so callers check here first.
 */
async function getModelFields(
  session: OdooSession,
  model: string
): Promise<Set<string>> {
  const { url, db } = session.connection
  const key = `${url}|${db}|${model}`
  const cached = fieldsCache.get(key)
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.fields
  }
  const description = await executeKw(session, model, "fields_get", [], {
    attributes: ["type"],
  })
  if (!isRecord(description)) {
    throw new HttpError(
      `${session.connection.label} didn't describe the ${model} fields.`,
      502
    )
  }
  const fields = new Set(Object.keys(description))
  fieldsCache.set(key, { fields, expiresAt: Date.now() + FIELDS_CACHE_TTL_MS })
  return fields
}

/**
 * Field linking a timesheet line to its helpdesk ticket: Odoo Enterprise's
 * Helpdesk, or OCA's helpdesk_mgmt_timesheet.
 */
const TICKET_LINK_FIELDS = ["helpdesk_ticket_id", "ticket_id"] as const
type TicketLinkField = (typeof TICKET_LINK_FIELDS)[number]

function findTicketLinkField(lineFields: Set<string>): TicketLinkField | null {
  return TICKET_LINK_FIELDS.find((field) => lineFields.has(field)) ?? null
}

/**
 * The timesheet fields to read, plus "validated" (Timesheets app) and the
 * ticket link (Helpdesk timesheets) when the instance has them.
 */
async function timesheetFields(
  session: OdooSession,
  base: readonly string[]
): Promise<string[]> {
  const fields = await getModelFields(session, "account.analytic.line")
  const ticketLink = findTicketLinkField(fields)
  return [
    ...base,
    ...(fields.has("validated") ? ["validated"] : []),
    ...(ticketLink === null ? [] : [ticketLink]),
  ]
}

/* ------------------------------------------------------------------ */
/* SEARCH_TASK                                                         */
/* ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True when the reference is a whole token: "03-500" matches "[03-500]" but not "103-500" or "03-5001". */
function containsWholeRef(value: unknown, taskRef: string): boolean {
  if (typeof value !== "string") {
    return false
  }
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9-])${escapeRegExp(taskRef)}($|[^A-Za-z0-9-])`,
    "i"
  )
  return pattern.test(value)
}

async function findTask(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  taskRef: string
): Promise<TaskMatch | null> {
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [[["name", "ilike", taskRef]]],
    {
      fields: ["id", "name", "project_id"],
      limit: TASK_CANDIDATE_LIMIT,
      order: "id desc",
    }
  )
  if (!Array.isArray(records)) {
    throw new HttpError(
      `${session.connection.label} returned an invalid task list.`,
      502
    )
  }

  for (const record of records) {
    if (!isRecord(record) || !containsWholeRef(record.name, taskRef)) {
      continue
    }
    const project = readMany2one(record.project_id)
    if (
      isPositiveInteger(record.id) &&
      typeof record.name === "string" &&
      project !== null
    ) {
      return {
        taskId: record.id,
        taskName: record.name,
        projectId: project.id,
        projectName: project.name,
        instanceIndex,
      }
    }
  }
  return null
}

/** Looks each reference up in instance 1, then the still missing ones in instance 2. */
async function searchTasks(
  instances: OdooInstanceSettings[],
  taskRefs: string[]
): Promise<TaskSearchResult[]> {
  const getSession = createSessionPool(instances)
  const matches = new Map<string, TaskMatch>()
  let pending = taskRefs

  for (const { index } of instances) {
    if (pending.length === 0) {
      break
    }
    const session = await getSession(index)
    const found = await Promise.all(
      pending.map((taskRef) => findTask(session, index, taskRef))
    )
    found.forEach((match, position) => {
      if (match !== null) {
        matches.set(pending[position], match)
      }
    })
    pending = pending.filter((taskRef) => !matches.has(taskRef))
  }

  return taskRefs.map((taskRef) => {
    const match = matches.get(taskRef)
    return match === undefined
      ? { taskRef, found: false }
      : { taskRef, found: true, ...match }
  })
}

/* ------------------------------------------------------------------ */
/* SUBMIT_TIMESHEET                                                    */
/* ------------------------------------------------------------------ */

async function createTimesheet(
  session: OdooSession,
  entry: TimesheetSubmission
): Promise<SubmissionResult> {
  try {
    const timesheetId = await executeKw(
      session,
      "account.analytic.line",
      "create",
      [
        {
          name: entry.description,
          project_id: entry.projectId,
          task_id: entry.taskId,
          unit_amount: entry.hours,
          date: entry.date,
        },
      ]
    )
    if (!isPositiveInteger(timesheetId)) {
      return {
        clientId: entry.clientId,
        success: false,
        error: "Odoo didn't return the new timesheet id.",
      }
    }
    return { clientId: entry.clientId, success: true, timesheetId }
  } catch (error) {
    if (error instanceof OdooRpcError) {
      return { clientId: entry.clientId, success: false, error: error.message }
    }
    throw error
  }
}

async function submitTimesheets(
  instances: OdooInstanceSettings[],
  entries: TimesheetSubmission[]
): Promise<SubmissionResult[]> {
  const getSession = createSessionPool(instances)
  const results = new Map<string, SubmissionResult>()

  for (const index of new Set(entries.map((entry) => entry.instanceIndex))) {
    const instanceEntries = entries.filter((e) => e.instanceIndex === index)

    let session: OdooSession
    try {
      session = await getSession(index)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const entry of instanceEntries) {
        results.set(entry.clientId, {
          clientId: entry.clientId,
          success: false,
          error: message,
        })
      }
      continue
    }

    // Sequential on purpose: one failing line must not hide the others' results.
    for (const entry of instanceEntries) {
      results.set(entry.clientId, await createTimesheet(session, entry))
    }
  }

  return entries.flatMap((entry) => {
    const result = results.get(entry.clientId)
    return result === undefined ? [] : [result]
  })
}

/* ------------------------------------------------------------------ */
/* FIND_TIMESHEETS                                                     */
/* ------------------------------------------------------------------ */

function lookupKey({ instanceIndex, taskId, date }: TimesheetLookup): string {
  return `${instanceIndex}:${taskId}:${date}`
}

function readLoggedTimesheet(
  record: unknown,
  instanceIndex: InstanceIndex
): LoggedTimesheet | null {
  if (!isRecord(record)) {
    return null
  }
  const task = readMany2one(record.task_id)
  if (
    !isPositiveInteger(record.id) ||
    task === null ||
    typeof record.date !== "string" ||
    typeof record.unit_amount !== "number"
  ) {
    return null
  }
  return {
    instanceIndex,
    taskId: task.id,
    date: record.date,
    timesheetId: record.id,
    hours: record.unit_amount,
    description: typeof record.name === "string" ? record.name : "",
    locked: record.validated === true,
  }
}

/** The signed-in user's own timesheets on the requested tasks and days. */
async function findTimesheets(
  instances: OdooInstanceSettings[],
  lookups: TimesheetLookup[]
): Promise<LoggedTimesheet[]> {
  const getSession = createSessionPool(instances)
  const wanted = new Set(lookups.map(lookupKey))
  const timesheets: LoggedTimesheet[] = []

  for (const index of new Set(lookups.map((lookup) => lookup.instanceIndex))) {
    const instanceLookups = lookups.filter((l) => l.instanceIndex === index)
    const taskIds = [...new Set(instanceLookups.map((l) => l.taskId))]
    const dates = instanceLookups.map((l) => l.date).sort()
    const session = await getSession(index)

    // One query per instance: every task over the whole date range, then
    // only the exact task and day pairs are kept.
    const records = await executeKw(
      session,
      "account.analytic.line",
      "search_read",
      [
        [
          ["user_id", "=", session.uid],
          ["task_id", "in", taskIds],
          ["date", ">=", dates[0]],
          ["date", "<=", dates[dates.length - 1]],
        ],
      ],
      {
        fields: await timesheetFields(session, [
          "task_id",
          "date",
          "unit_amount",
          "name",
        ]),
        limit: TIMESHEET_LOOKUP_LIMIT,
      }
    )
    if (!Array.isArray(records)) {
      throw new HttpError(
        `${session.connection.label} returned an invalid timesheet list.`,
        502
      )
    }

    for (const record of records) {
      const timesheet = readLoggedTimesheet(record, index)
      if (timesheet !== null && wanted.has(lookupKey(timesheet))) {
        timesheets.push(timesheet)
      }
    }
  }
  return timesheets
}

/* ------------------------------------------------------------------ */
/* GET_TASK                                                            */
/* ------------------------------------------------------------------ */

async function getTask(
  instances: OdooInstanceSettings[],
  { instanceIndex, taskId }: TaskReference
): Promise<TaskDetails> {
  const session = await createSessionPool(instances)(instanceIndex)
  const records = await executeKw(session, "project.task", "read", [[taskId]], {
    fields: ["name", "description", "project_id", "stage_id"],
  })
  const record = Array.isArray(records) ? records[0] : undefined
  if (!isRecord(record) || typeof record.name !== "string") {
    throw new HttpError("This task can't be read in Odoo.", 404)
  }
  return {
    taskId,
    name: record.name,
    descriptionHtml:
      typeof record.description === "string" ? record.description : "",
    projectName: readMany2one(record.project_id)?.name ?? null,
    stageName: readMany2one(record.stage_id)?.name ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Shared helpers for the multi-instance read actions                  */
/* ------------------------------------------------------------------ */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The requested instance, or every configured one in index order. */
function selectInstances(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): InstanceIndex[] {
  const configured = INSTANCE_INDEXES.filter((index) =>
    instances.some((instance) => instance.index === index)
  )
  if (instanceIndex === null) {
    return configured
  }
  if (!configured.includes(instanceIndex)) {
    throw new HttpError(
      `Odoo instance ${instanceIndex} is not configured.`,
      400
    )
  }
  return [instanceIndex]
}

/**
 * Runs `read` on each instance in parallel. Odoo and network errors become a
 * per-instance error; unexpected errors still fail the whole request.
 */
function readEachInstance<T>(
  instances: OdooInstanceSettings[],
  indexes: InstanceIndex[],
  read: (session: OdooSession, index: InstanceIndex) => Promise<T>
): Promise<InstanceResult<T>[]> {
  const getSession = createSessionPool(instances)
  return Promise.all(
    indexes.map(async (index): Promise<InstanceResult<T>> => {
      try {
        const data = await read(await getSession(index), index)
        return { instanceIndex: index, ok: true, ...data }
      } catch (error) {
        if (error instanceof HttpError) {
          return { instanceIndex: index, ok: false, error: errorMessage(error) }
        }
        throw error
      }
    })
  )
}

function readRecords(
  value: unknown,
  session: OdooSession,
  what: string
): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(
      `${session.connection.label} returned an invalid ${what} list.`,
      502
    )
  }
  return value
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Odoo dates and datetimes ("2026-10-13" or "2026-10-13 08:00:00") as YYYY-MM-DD. */
function readDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value.slice(0, 10))
    ? value.slice(0, 10)
    : null
}

/** Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS"; dates stay "YYYY-MM-DD". */
function readDeadline(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(value)
  if (match === null) {
    return null
  }
  return match[2] === undefined ? match[1] : `${match[1]}T${match[2]}Z`
}

/* ------------------------------------------------------------------ */
/* GET_MY_TASKS                                                        */
/* ------------------------------------------------------------------ */

/**
 * project.task fields differ between Odoo versions:
 * - user_id (single assignee) was replaced by user_ids in Odoo 15;
 * - kanban_state was replaced by state in Odoo 17;
 * - planned_hours was renamed allocated_hours in Odoo 17;
 * - effective_hours only exists when Timesheets (hr_timesheet) is installed.
 * Asking search_read for a missing field fails, so the fields are detected
 * first and only the existing ones are requested.
 */
interface TaskFieldSupport {
  assigneeDomain: unknown[]
  fields: string[]
  plannedField: "allocated_hours" | "planned_hours" | null
  statusField: "kanban_state" | "state" | null
  hasEffectiveHours: boolean
}

const BASE_TASK_FIELDS = [
  "id",
  "name",
  "project_id",
  "stage_id",
  "priority",
  "date_deadline",
]

async function detectTaskFields(
  session: OdooSession
): Promise<TaskFieldSupport> {
  const available = await getModelFields(session, "project.task")
  const has = (field: string): boolean => available.has(field)
  const { uid } = session

  let assigneeDomain: unknown[]
  if (has("user_id") && has("user_ids")) {
    assigneeDomain = [
      "&",
      ["active", "=", true],
      "|",
      ["user_id", "=", uid],
      ["user_ids", "in", [uid]],
    ]
  } else if (has("user_ids")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_ids", "in", [uid]],
    ]
  } else if (has("user_id")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_id", "=", uid],
    ]
  } else {
    throw new HttpError(
      `${session.connection.label} has no task assignee field.`,
      502
    )
  }

  const plannedField = has("allocated_hours")
    ? "allocated_hours"
    : has("planned_hours")
      ? "planned_hours"
      : null
  const statusField = has("kanban_state")
    ? "kanban_state"
    : has("state")
      ? "state"
      : null
  const hasEffectiveHours = has("effective_hours")

  const fields = BASE_TASK_FIELDS.filter(has)
  if (plannedField !== null) fields.push(plannedField)
  if (statusField !== null) fields.push(statusField)
  if (hasEffectiveHours) fields.push("effective_hours")

  return {
    assigneeDomain,
    fields,
    plannedField,
    statusField,
    hasEffectiveHours,
  }
}

const KANBAN_STATE_STATUSES: Readonly<Record<string, KanbanTaskStatus>> = {
  normal: "in_progress",
  done: "approved",
  blocked: "blocked",
}

const STATE_STATUSES: Readonly<Record<string, KanbanTaskStatus>> = {
  "01_in_progress": "in_progress",
  "02_changes_requested": "changes_requested",
  "03_approved": "approved",
  "04_waiting_normal": "waiting",
  "1_done": "done",
  "1_canceled": "canceled",
}

function readTaskStatus(
  value: unknown,
  field: TaskFieldSupport["statusField"]
): KanbanTaskStatus | null {
  if (typeof value !== "string" || field === null) {
    return null
  }
  const statuses =
    field === "kanban_state" ? KANBAN_STATE_STATUSES : STATE_STATUSES
  return statuses[value] ?? null
}

function readKanbanTask(
  record: unknown,
  instanceIndex: InstanceIndex,
  support: TaskFieldSupport
): KanbanTask | null {
  if (
    !isRecord(record) ||
    !isPositiveInteger(record.id) ||
    typeof record.name !== "string"
  ) {
    return null
  }
  const project = readMany2one(record.project_id)
  const stage = readMany2one(record.stage_id)
  const priority = Number(record.priority)
  const planned =
    support.plannedField === null
      ? null
      : readNumber(record[support.plannedField])

  return {
    instanceIndex,
    taskId: record.id,
    name: record.name,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    stageId: stage?.id ?? null,
    stageName: stage?.name ?? null,
    priority: Number.isInteger(priority) && priority > 0 ? priority : 0,
    deadline: readDeadline(record.date_deadline),
    status: readTaskStatus(
      support.statusField === null ? undefined : record[support.statusField],
      support.statusField
    ),
    plannedHours: planned !== null && planned > 0 ? planned : null,
    effectiveHours: support.hasEffectiveHours
      ? (readNumber(record.effective_hours) ?? 0)
      : null,
  }
}

function readKanbanStage(
  record: unknown,
  instanceIndex: InstanceIndex
): KanbanStage | null {
  if (
    !isRecord(record) ||
    !isPositiveInteger(record.id) ||
    typeof record.name !== "string"
  ) {
    return null
  }
  return {
    instanceIndex,
    stageId: record.id,
    name: record.name,
    sequence: readNumber(record.sequence) ?? 0,
    folded: record.fold === true,
  }
}

/** The stages of the tasks' projects, plus any stage a task sits in. */
async function readStages(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  tasks: KanbanTask[]
): Promise<KanbanStage[]> {
  const projectIds = [...new Set(tasks.flatMap((task) => task.projectId ?? []))]
  const stageIds = [...new Set(tasks.flatMap((task) => task.stageId ?? []))]
  if (projectIds.length === 0 && stageIds.length === 0) {
    return []
  }

  const records = await executeKw(
    session,
    "project.task.type",
    "search_read",
    [["|", ["id", "in", stageIds], ["project_ids", "in", projectIds]]],
    {
      fields: ["id", "name", "sequence", "fold"],
      order: "sequence asc, id asc",
    }
  )
  return readRecords(records, session, "stage").flatMap(
    (record) => readKanbanStage(record, instanceIndex) ?? []
  )
}

async function readMyTasks(
  session: OdooSession,
  instanceIndex: InstanceIndex
): Promise<{ tasks: KanbanTask[]; stages: KanbanStage[]; truncated: boolean }> {
  const support = await detectTaskFields(session)
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [support.assigneeDomain],
    {
      fields: support.fields,
      limit: MY_TASKS_LIMIT,
      order: "priority desc, id desc",
    }
  )
  const rawTasks = readRecords(records, session, "task")
  const tasks = rawTasks.flatMap(
    (record) => readKanbanTask(record, instanceIndex, support) ?? []
  )
  const stages = await readStages(session, instanceIndex, tasks)
  return { tasks, stages, truncated: rawTasks.length >= MY_TASKS_LIMIT }
}

function getMyTasks(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): Promise<MyTasksResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    readMyTasks
  )
}

/* ------------------------------------------------------------------ */
/* GET_TIMESHEET_HISTORY                                               */
/* ------------------------------------------------------------------ */

const HISTORY_FIELDS = [
  "id",
  "name",
  "unit_amount",
  "date",
  "project_id",
  "task_id",
]

function readHistoryEntry(
  record: unknown,
  instanceIndex: InstanceIndex
): TimesheetHistoryEntry | null {
  if (!isRecord(record) || !isPositiveInteger(record.id)) {
    return null
  }
  const date = readDate(record.date)
  const hours = readNumber(record.unit_amount)
  if (date === null || hours === null) {
    return null
  }
  const project = readMany2one(record.project_id)
  const task = readMany2one(record.task_id)
  const ticket =
    readMany2one(record.helpdesk_ticket_id) ?? readMany2one(record.ticket_id)
  return {
    instanceIndex,
    timesheetId: record.id,
    date,
    description: typeof record.name === "string" ? record.name : "",
    hours,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    taskId: task?.id ?? null,
    taskName: task?.name ?? null,
    ticketId: ticket?.id ?? null,
    ticketName: ticket?.name ?? null,
    locked: record.validated === true,
  }
}

function getTimesheetHistory(
  instances: OdooInstanceSettings[],
  { dateFrom, dateTo, instanceIndex }: HistoryQuery
): Promise<TimesheetHistoryResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      // project_id set: timesheets only, not other analytic lines.
      const records = await executeKw(
        session,
        "account.analytic.line",
        "search_read",
        [
          [
            ["user_id", "=", session.uid],
            ["project_id", "!=", false],
            ["date", ">=", dateFrom],
            ["date", "<=", dateTo],
          ],
        ],
        {
          fields: await timesheetFields(session, HISTORY_FIELDS),
          limit: HISTORY_LIMIT,
          order: "date desc, id desc",
        }
      )
      const rawEntries = readRecords(records, session, "timesheet")
      return {
        entries: rawEntries.flatMap(
          (record) => readHistoryEntry(record, index) ?? []
        ),
        truncated: rawEntries.length >= HISTORY_LIMIT,
      }
    }
  )
}

/* ------------------------------------------------------------------ */
/* UPDATE_TIMESHEET / DELETE_TIMESHEET                                 */
/* ------------------------------------------------------------------ */

/**
 * Reads a timesheet only if it belongs to the signed-in user, so the gateway
 * never edits a colleague's line, even with a manager's access rights.
 */
async function readOwnTimesheet(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  timesheetId: number
): Promise<TimesheetHistoryEntry> {
  const records = await executeKw(
    session,
    "account.analytic.line",
    "search_read",
    [
      [
        ["id", "=", timesheetId],
        ["user_id", "=", session.uid],
      ],
    ],
    { fields: await timesheetFields(session, HISTORY_FIELDS), limit: 1 }
  )
  const entry = readHistoryEntry(
    readRecords(records, session, "timesheet")[0],
    instanceIndex
  )
  if (entry === null) {
    throw new HttpError(
      `Timesheet ${timesheetId} doesn't exist in ${session.connection.label}, or isn't yours.`,
      404
    )
  }
  return entry
}

/** A validated line can't change: say so before Odoo refuses with a vaguer message. */
function requireUnlocked(entry: TimesheetHistoryEntry): void {
  if (entry.locked) {
    throw new HttpError(
      "This timesheet is validated in Odoo and can't be changed anymore.",
      409
    )
  }
}

/** Odoo refusals (validated timesheet, locked period...) are conflicts, not gateway failures. */
async function asConflict<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new HttpError(error.message, 409)
    }
    throw error
  }
}

async function updateTimesheet(
  instances: OdooInstanceSettings[],
  { instanceIndex, timesheetId, hours, description }: TimesheetUpdate
): Promise<TimesheetHistoryEntry> {
  const session = await createSessionPool(instances)(instanceIndex)
  requireUnlocked(await readOwnTimesheet(session, instanceIndex, timesheetId))
  const written = await asConflict(
    executeKw(session, "account.analytic.line", "write", [
      [timesheetId],
      { unit_amount: hours, name: description },
    ])
  )
  if (written !== true) {
    throw new HttpError("Odoo didn't confirm the update.", 502)
  }
  // Read back what Odoo stored (rounding, onchange side effects).
  return readOwnTimesheet(session, instanceIndex, timesheetId)
}

async function deleteTimesheet(
  instances: OdooInstanceSettings[],
  { instanceIndex, timesheetId }: TimesheetReference
): Promise<TimesheetReference> {
  const session = await createSessionPool(instances)(instanceIndex)
  requireUnlocked(await readOwnTimesheet(session, instanceIndex, timesheetId))
  const deleted = await asConflict(
    executeKw(session, "account.analytic.line", "unlink", [[timesheetId]])
  )
  if (deleted !== true) {
    throw new HttpError("Odoo didn't confirm the deletion.", 502)
  }
  return { instanceIndex, timesheetId }
}

/* ------------------------------------------------------------------ */
/* SEARCH_TASKS                                                        */
/* ------------------------------------------------------------------ */

/** "18486" or "#18486" as a record id; null for any other text. */
function readIdQuery(query: string): number | null {
  const match = /^#?(\d{1,9})$/.exec(query)
  return match === null ? null : Number(match[1])
}

/** OR of the leaves, in Odoo's prefix notation. */
function anyOf(leaves: unknown[]): unknown[] {
  return [...Array(Math.max(0, leaves.length - 1)).fill("|"), ...leaves]
}

/** Any active task with a project, assigned or not, by name, project or id. */
function searchAllTasks(
  instances: OdooInstanceSettings[],
  query: string,
  instanceIndex: InstanceIndex | null
): Promise<TaskSearchInstanceResult[]> {
  const id = readIdQuery(query)
  const matches = anyOf([
    ["name", "ilike", query],
    ["project_id", "ilike", query],
    ...(id === null ? [] : [["id", "=", id]]),
  ])
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTaskFields(session)
      const records = await executeKw(
        session,
        "project.task",
        "search_read",
        [[["active", "=", true], ["project_id", "!=", false], ...matches]],
        {
          fields: support.fields,
          limit: SEARCH_LIMIT,
          order: "priority desc, id desc",
        }
      )
      const raw = readRecords(records, session, "task")
      return {
        tasks: raw.flatMap(
          (record) => readKanbanTask(record, index, support) ?? []
        ),
        truncated: raw.length >= SEARCH_LIMIT,
      }
    }
  )
}

/* ------------------------------------------------------------------ */
/* SEARCH_TICKETS                                                      */
/* ------------------------------------------------------------------ */

const TICKET_MODEL = "helpdesk.ticket"
const BASE_TICKET_FIELDS = ["id", "name", "stage_id", "team_id", "priority"]

/**
 * Fields holding a ticket's reference ("HT10605"), by preference: Odoo's
 * own (recent versions), then "number" (helpdesk_mgmt and similar apps).
 */
const TICKET_REF_FIELDS = ["ticket_ref", "number"] as const

interface TicketSupport {
  fields: string[]
  /** The reference field of this instance, if any. */
  refField: (typeof TICKET_REF_FIELDS)[number] | null
  /** Field linking timesheet lines to tickets; null without ticket timesheets. */
  lineLink: TicketLinkField | null
  /** Ticket flag telling whether its team logs time on tickets. */
  timesheetFlag: "use_helpdesk_timesheet" | "allow_timesheet" | null
  hoursField: "total_hours_spent" | "effective_hours" | "total_hours" | null
  hasTask: boolean
  openDomain: unknown[]
}

/**
 * null when no helpdesk app is installed. Works with Odoo Enterprise's
 * Helpdesk and with OCA's helpdesk_mgmt (+ helpdesk_mgmt_timesheet), whose
 * field names differ.
 */
async function detectTicketFields(
  session: OdooSession
): Promise<TicketSupport | null> {
  let ticket: Set<string>
  try {
    ticket = await getModelFields(session, TICKET_MODEL)
  } catch (error) {
    // Odoo answers "Object helpdesk.ticket doesn't exist" without the app.
    if (error instanceof OdooRpcError) {
      return null
    }
    throw error
  }
  const lines = await getModelFields(session, "account.analytic.line")
  const has = (field: string) => ticket.has(field)
  const first = <T extends string>(candidates: readonly T[]): T | null =>
    candidates.find((field) => has(field)) ?? null

  const refField = first(TICKET_REF_FIELDS)
  const timesheetFlag = first([
    "use_helpdesk_timesheet",
    "allow_timesheet",
  ] as const)
  const hoursField = first([
    "total_hours_spent",
    "effective_hours",
    "total_hours",
  ] as const)
  const hasTask = has("task_id")
  const optional = [
    refField,
    "project_id",
    timesheetFlag,
    hoursField,
    hasTask ? "task_id" : null,
  ].filter((field): field is string => field !== null && has(field))

  // Open tickets, as each app marks closing: a close date (Enterprise), a
  // "closed" flag from the stage (OCA), or else a folded stage.
  const openDomain = has("close_date")
    ? [["close_date", "=", false]]
    : has("closed")
      ? [["closed", "=", false]]
      : [["stage_id.fold", "=", false]]

  return {
    fields: [...BASE_TICKET_FIELDS.filter(has), ...optional],
    refField,
    lineLink: has("project_id") ? findTicketLinkField(lines) : null,
    timesheetFlag,
    hoursField,
    hasTask,
    openDomain,
  }
}

function readTicket(
  record: unknown,
  instanceIndex: InstanceIndex,
  support: TicketSupport
): HelpdeskTicket | null {
  if (
    !isRecord(record) ||
    !isPositiveInteger(record.id) ||
    typeof record.name !== "string"
  ) {
    return null
  }
  const project = readMany2one(record.project_id)
  const priority = Number(record.priority)
  return {
    instanceIndex,
    ticketId: record.id,
    name: record.name,
    ref:
      support.refField !== null && typeof record[support.refField] === "string"
        ? (record[support.refField] as string)
        : null,
    stageName: readMany2one(record.stage_id)?.name ?? null,
    teamName: readMany2one(record.team_id)?.name ?? null,
    priority: Number.isInteger(priority) && priority > 0 ? priority : 0,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    hoursSpent:
      support.hoursField === null
        ? null
        : (readNumber(record[support.hoursField]) ?? 0),
    loggable:
      support.lineLink !== null &&
      project !== null &&
      (support.timesheetFlag === null ||
        record[support.timesheetFlag] !== false),
  }
}

function searchTickets(
  instances: OdooInstanceSettings[],
  { query, mine, instanceIndex }: TicketQuery
): Promise<TicketsInstanceResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTicketFields(session)
      if (support === null) {
        return { available: false, tickets: [], truncated: false }
      }
      const id = readIdQuery(query)
      const matches =
        query === ""
          ? []
          : anyOf([
              ["name", "ilike", query],
              ...(support.refField === null
                ? []
                : [[support.refField, "ilike", query]]),
              ...(id === null ? [] : [["id", "=", id]]),
            ])
      const limit = mine ? MY_TICKETS_LIMIT : SEARCH_LIMIT
      const records = await executeKw(
        session,
        TICKET_MODEL,
        "search_read",
        [
          [
            ...support.openDomain,
            ...(mine ? [["user_id", "=", session.uid]] : []),
            ...matches,
          ],
        ],
        { fields: support.fields, limit, order: "priority desc, id desc" }
      )
      const raw = readRecords(records, session, "ticket")
      return {
        available: true,
        tickets: raw.flatMap(
          (record) => readTicket(record, index, support) ?? []
        ),
        truncated: raw.length >= limit,
      }
    }
  )
}

/* ------------------------------------------------------------------ */
/* LOG_TICKET_TIME                                                     */
/* ------------------------------------------------------------------ */

/** Logs time on a ticket, on the project its helpdesk team logs time in. */
async function logTicketTime(
  instances: OdooInstanceSettings[],
  entry: TicketTimeEntry
): Promise<{ timesheetId: number }> {
  const session = await createSessionPool(instances)(entry.instanceIndex)
  const support = await detectTicketFields(session)
  if (support === null || support.lineLink === null) {
    throw new HttpError(
      `${session.connection.label} doesn't track time on helpdesk tickets.`,
      409
    )
  }
  const records = await executeKw(
    session,
    TICKET_MODEL,
    "read",
    [[entry.ticketId]],
    { fields: support.fields }
  )
  const ticket = readTicket(
    Array.isArray(records) ? records[0] : undefined,
    entry.instanceIndex,
    support
  )
  if (ticket === null) {
    throw new HttpError("This ticket can't be read in Odoo.", 404)
  }
  if (!ticket.loggable || ticket.projectId === null) {
    throw new HttpError(
      "Time can't be logged on this ticket: its helpdesk team has no timesheet project.",
      409
    )
  }
  const record = Array.isArray(records) ? records[0] : undefined
  // OCA tickets can point at a task of the project: the line goes there too.
  const task =
    support.hasTask && isRecord(record) ? readMany2one(record.task_id) : null
  const timesheetId = await asConflict(
    executeKw(session, "account.analytic.line", "create", [
      {
        name: entry.description,
        project_id: ticket.projectId,
        [support.lineLink]: entry.ticketId,
        ...(task === null ? {} : { task_id: task.id }),
        unit_amount: entry.hours,
        date: entry.date,
      },
    ])
  )
  if (!isPositiveInteger(timesheetId)) {
    throw new HttpError("Odoo didn't return the new timesheet id.", 502)
  }
  return { timesheetId }
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

serveJson("odoo-gateway", {
  POST: async ({ request, userId }) => {
    const gatewayRequest = parseRequest(await readJsonBody(request))
    const instances = requireOdooInstances(await loadSettings(userId))
    switch (gatewayRequest.action) {
      case "SEARCH_TASK":
        return {
          results: await searchTasks(instances, gatewayRequest.taskRefs),
        }
      case "SUBMIT_TIMESHEET":
        return {
          results: await submitTimesheets(instances, gatewayRequest.entries),
        }
      case "FIND_TIMESHEETS":
        return {
          results: await findTimesheets(instances, gatewayRequest.lookups),
        }
      case "GET_TASK":
        return { task: await getTask(instances, gatewayRequest) }
      case "GET_MY_TASKS":
        return {
          instances: await getMyTasks(instances, gatewayRequest.instanceIndex),
        }
      case "GET_TIMESHEET_HISTORY":
        return {
          instances: await getTimesheetHistory(instances, gatewayRequest),
        }
      case "UPDATE_TIMESHEET":
        return { timesheet: await updateTimesheet(instances, gatewayRequest) }
      case "DELETE_TIMESHEET":
        return { deleted: await deleteTimesheet(instances, gatewayRequest) }
      case "SEARCH_TASKS":
        return {
          instances: await searchAllTasks(
            instances,
            gatewayRequest.query,
            gatewayRequest.instanceIndex
          ),
        }
      case "SEARCH_TICKETS":
        return { instances: await searchTickets(instances, gatewayRequest) }
      case "LOG_TICKET_TIME":
        return await logTicketTime(instances, gatewayRequest)
    }
  },
})
