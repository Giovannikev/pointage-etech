import { HttpError } from "../_shared/errors.ts"
import type { InstanceIndex } from "../_shared/settings.ts"
import {
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from "../_shared/validation.ts"
import {
  isKanbanTaskStatus,
  type HistoryQuery,
  type KanbanTaskStatus,
  type LeaveReference,
  type ProjectTaskQuery,
  type RecordFilters,
  type TaskListQuery,
  type TaskNote,
  type TaskReference,
  type TaskUpdate,
  type TicketQuery,
  type TicketTimeEntry,
  type TimeOffRequest,
  type TimesheetLookup,
  type TimesheetReference,
  type TimesheetSubmission,
  type TimesheetUpdate,
} from "./contract.ts"
import { hasRecordFilters } from "./filters.ts"
import { ISO_DATE, MS_PER_DAY } from "./helpers.ts"

export type GatewayRequest =
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
  | { action: "LIST_PROJECTS"; instanceIndex: InstanceIndex }
  | ({ action: "LIST_PROJECT_TASKS" } & ProjectTaskQuery)
  | ({ action: "UPDATE_TASK" } & TaskUpdate)
  | ({ action: "POST_TASK_NOTE" } & TaskNote)
  | { action: "GET_TIME_OFF"; instanceIndex: InstanceIndex | null }
  | ({ action: "REQUEST_TIME_OFF" } & TimeOffRequest)
  | ({ action: "UPDATE_TIME_OFF" } & TimeOffRequest & { leaveId: number })
  | ({ action: "DELETE_TIME_OFF" } & LeaveReference)
  | ({ action: "GET_ATTENDANCE" } & HistoryQuery)
  | {
      action: "CHECK_IN_OUT"
      instanceIndex: InstanceIndex
      /** The punch the user asked for; without it, a plain toggle. */
      direction: "in" | "out" | null
    }
  | ({ action: "LIST_TASKS" } & TaskListQuery)
  | { action: "LIST_ASSIGNEES"; instanceIndex: InstanceIndex | null }

type GatewayAction = GatewayRequest["action"]
type RequestOf<A extends GatewayAction> = Extract<GatewayRequest, { action: A }>
type Body = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

const MAX_ITEMS_PER_REQUEST = 100
/** A month of commits can touch more task and day pairs than a submission. */
const MAX_LOOKUPS_PER_REQUEST = 500
const MAX_TASK_REF_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_NOTE_LENGTH = 20_000
const MAX_LEAVE_DAYS = 366
const MAX_HISTORY_DAYS = 366
const MAX_FILTER_KEYS = 200
const PROJECT_FILTER_KEY = /^[12]:\d{1,9}$/
const ASSIGNEE_FILTER_KEY = /^(?:[12]:\d{1,9}|none)$/
const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 100

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

function parseTaskReference(body: Body): TaskReference {
  if (!isInstanceIndex(body.instanceIndex) || !isPositiveInteger(body.taskId)) {
    throw new HttpError('"instanceIndex" and "taskId" are required.', 400)
  }
  return { instanceIndex: body.instanceIndex, taskId: body.taskId }
}

function parseTimesheetReference(body: Body): TimesheetReference {
  if (
    !isInstanceIndex(body.instanceIndex) ||
    !isPositiveInteger(body.timesheetId)
  ) {
    throw new HttpError('"instanceIndex" and "timesheetId" are required.', 400)
  }
  return { instanceIndex: body.instanceIndex, timesheetId: body.timesheetId }
}

function parseHistoryQuery(body: Body): HistoryQuery {
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

/** An hour of the day as Odoo stores it: 9.5 for 09:30. */
function isHourOfDay(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 24
  )
}

function parseTimeOffRequest(body: Body): TimeOffRequest {
  const { instanceIndex, leaveTypeId, dateFrom, dateTo, period } = body
  if (!isInstanceIndex(instanceIndex) || !isPositiveInteger(leaveTypeId)) {
    throw new HttpError('"instanceIndex" and "leaveTypeId" are required.', 400)
  }
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateTo < dateFrom) {
    throw new HttpError(
      '"dateFrom" and "dateTo" must be dates (YYYY-MM-DD), in order.',
      400
    )
  }
  const days =
    (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) /
      MS_PER_DAY +
    1
  if (days > MAX_LEAVE_DAYS) {
    throw new HttpError(`A request lasts at most ${MAX_LEAVE_DAYS} days.`, 400)
  }
  if (
    period !== undefined &&
    period !== null &&
    period !== "am" &&
    period !== "pm"
  ) {
    throw new HttpError('"period" must be "am", "pm" or null.', 400)
  }
  const hasHours = body.hourFrom !== undefined && body.hourFrom !== null
  if (
    hasHours &&
    (!isHourOfDay(body.hourFrom) ||
      !isHourOfDay(body.hourTo) ||
      body.hourTo <= body.hourFrom)
  ) {
    throw new HttpError(
      '"hourFrom" and "hourTo" must be hours of the day (0 to 24), in order.',
      400
    )
  }
  const description =
    typeof body.description === "string" ? body.description.trim() : ""
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(
      `"description" is limited to ${MAX_DESCRIPTION_LENGTH} characters.`,
      400
    )
  }
  return {
    instanceIndex,
    leaveTypeId,
    dateFrom,
    dateTo,
    period: period === "am" || period === "pm" ? period : null,
    hourFrom: hasHours ? (body.hourFrom as number) : null,
    hourTo: hasHours ? (body.hourTo as number) : null,
    description,
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

/** A list of filter keys; omitted means no filter. */
function readFilterKeys(
  value: unknown,
  field: string,
  pattern: RegExp
): string[] {
  if (value === undefined || value === null) {
    return []
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_FILTER_KEYS ||
    !value.every((key) => typeof key === "string" && pattern.test(key))
  ) {
    throw new HttpError(
      `"${field}" must be at most ${MAX_FILTER_KEYS} keys such as "1:12".`,
      400
    )
  }
  return [...new Set(value as string[])]
}

function readRecordFilters(body: Body): RecordFilters {
  return {
    projects: readFilterKeys(body.projects, "projects", PROJECT_FILTER_KEY),
    assignees: readFilterKeys(body.assignees, "assignees", ASSIGNEE_FILTER_KEY),
  }
}

/*
 * The two readers below return their type explicitly instead of narrowing
 * `unknown` inline: the dashboard editor type-checks without strict null
 * checks, where `x !== null && !guard(x)` doesn't narrow.
 */

function readOptionalStageId(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isPositiveInteger(value)) {
    throw new HttpError('"stageId" must be a stage id.', 400)
  }
  return value
}

function readOptionalStatus(value: unknown): KanbanTaskStatus | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isKanbanTaskStatus(value)) {
    throw new HttpError('"status" is not a known task state.', 400)
  }
  return value
}

/* ------------------------------------------------------------------ */
/* One parser per action                                               */
/* ------------------------------------------------------------------ */

function parseSearchTask(body: Body): RequestOf<"SEARCH_TASK"> {
  const taskRefs = readBatch(body.taskRefs, "taskRefs").map((ref) => {
    if (!isNonEmptyString(ref, MAX_TASK_REF_LENGTH)) {
      throw new HttpError("Every task reference must be a short string.", 400)
    }
    return ref.trim()
  })
  return { action: "SEARCH_TASK", taskRefs: [...new Set(taskRefs)] }
}

function parseSubmitTimesheet(body: Body): RequestOf<"SUBMIT_TIMESHEET"> {
  const entries = readBatch(body.entries, "entries").map(parseSubmission)
  return { action: "SUBMIT_TIMESHEET", entries }
}

function parseFindTimesheets(body: Body): RequestOf<"FIND_TIMESHEETS"> {
  const lookups = readBatch(
    body.lookups,
    "lookups",
    MAX_LOOKUPS_PER_REQUEST
  ).map(parseLookup)
  return { action: "FIND_TIMESHEETS", lookups }
}

function parseGetTask(body: Body): RequestOf<"GET_TASK"> {
  return { action: "GET_TASK", ...parseTaskReference(body) }
}

function parseUpdateTask(body: Body): RequestOf<"UPDATE_TASK"> {
  const reference = parseTaskReference(body)
  const stageId = readOptionalStageId(body.stageId)
  const status = readOptionalStatus(body.status)
  if (stageId === null && status === null) {
    throw new HttpError('Send "stageId", "status" or both.', 400)
  }
  return { action: "UPDATE_TASK", ...reference, stageId, status }
}

function parsePostTaskNote(body: Body): RequestOf<"POST_TASK_NOTE"> {
  const reference = parseTaskReference(body)
  if (!isNonEmptyString(body.note, MAX_NOTE_LENGTH)) {
    throw new HttpError(
      `"note" must be a non-empty text of at most ${MAX_NOTE_LENGTH} characters.`,
      400
    )
  }
  return {
    action: "POST_TASK_NOTE",
    ...reference,
    note: body.note,
    approve: body.approve === true,
  }
}

function parseGetTimeOff(body: Body): RequestOf<"GET_TIME_OFF"> {
  return {
    action: "GET_TIME_OFF",
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

function parseRequestTimeOff(body: Body): RequestOf<"REQUEST_TIME_OFF"> {
  return { action: "REQUEST_TIME_OFF", ...parseTimeOffRequest(body) }
}

function parseUpdateTimeOff(body: Body): RequestOf<"UPDATE_TIME_OFF"> {
  if (!isPositiveInteger(body.leaveId)) {
    throw new HttpError('"leaveId" is required.', 400)
  }
  return {
    action: "UPDATE_TIME_OFF",
    ...parseTimeOffRequest(body),
    leaveId: body.leaveId,
  }
}

function parseDeleteTimeOff(body: Body): RequestOf<"DELETE_TIME_OFF"> {
  if (
    !isInstanceIndex(body.instanceIndex) ||
    !isPositiveInteger(body.leaveId)
  ) {
    throw new HttpError('"instanceIndex" and "leaveId" are required.', 400)
  }
  return {
    action: "DELETE_TIME_OFF",
    instanceIndex: body.instanceIndex,
    leaveId: body.leaveId,
  }
}

function parseGetAttendance(body: Body): RequestOf<"GET_ATTENDANCE"> {
  return { action: "GET_ATTENDANCE", ...parseHistoryQuery(body) }
}

function parseCheckInOut(body: Body): RequestOf<"CHECK_IN_OUT"> {
  if (!isInstanceIndex(body.instanceIndex)) {
    throw new HttpError('"instanceIndex" is required.', 400)
  }
  const direction = body.direction ?? null
  if (direction !== null && direction !== "in" && direction !== "out") {
    throw new HttpError('"direction" must be "in" or "out".', 400)
  }
  return {
    action: "CHECK_IN_OUT",
    instanceIndex: body.instanceIndex,
    direction,
  }
}

function parseGetMyTasks(body: Body): RequestOf<"GET_MY_TASKS"> {
  return {
    action: "GET_MY_TASKS",
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

function parseGetTimesheetHistory(
  body: Body
): RequestOf<"GET_TIMESHEET_HISTORY"> {
  return { action: "GET_TIMESHEET_HISTORY", ...parseHistoryQuery(body) }
}

function parseUpdateTimesheet(body: Body): RequestOf<"UPDATE_TIMESHEET"> {
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

function parseDeleteTimesheet(body: Body): RequestOf<"DELETE_TIMESHEET"> {
  return { action: "DELETE_TIMESHEET", ...parseTimesheetReference(body) }
}

function parseSearchTasks(body: Body): RequestOf<"SEARCH_TASKS"> {
  return {
    action: "SEARCH_TASKS",
    query: readQuery(body.query, false),
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

function parseSearchTickets(body: Body): RequestOf<"SEARCH_TICKETS"> {
  const mine = body.mine === true
  const filters = readRecordFilters(body)
  return {
    action: "SEARCH_TICKETS",
    mine,
    // A filter is enough to list tickets: the query becomes optional.
    query: readQuery(body.query, mine || hasRecordFilters(filters)),
    instanceIndex: readOptionalInstance(body.instanceIndex),
    filters,
  }
}

function parseListTasks(body: Body): RequestOf<"LIST_TASKS"> {
  const filters = readRecordFilters(body)
  const query = readQuery(body.query, true)
  // Without any filter, every task of the instance would be read.
  if (query === "" && !hasRecordFilters(filters)) {
    throw new HttpError(
      'Send a "query", "projects" or "assignees" to narrow the tasks.',
      400
    )
  }
  return {
    action: "LIST_TASKS",
    query,
    ...filters,
    includeClosed: body.includeClosed === true,
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

function parseListAssignees(body: Body): RequestOf<"LIST_ASSIGNEES"> {
  return {
    action: "LIST_ASSIGNEES",
    instanceIndex: readOptionalInstance(body.instanceIndex),
  }
}

function parseLogTicketTime(body: Body): RequestOf<"LOG_TICKET_TIME"> {
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

function parseListProjects(body: Body): RequestOf<"LIST_PROJECTS"> {
  if (!isInstanceIndex(body.instanceIndex)) {
    throw new HttpError('"instanceIndex" is required.', 400)
  }
  return { action: "LIST_PROJECTS", instanceIndex: body.instanceIndex }
}

function parseListProjectTasks(body: Body): RequestOf<"LIST_PROJECT_TASKS"> {
  if (
    !isInstanceIndex(body.instanceIndex) ||
    !isPositiveInteger(body.projectId)
  ) {
    throw new HttpError('"instanceIndex" and "projectId" are required.', 400)
  }
  return {
    action: "LIST_PROJECT_TASKS",
    instanceIndex: body.instanceIndex,
    projectId: body.projectId,
    query: readQuery(body.query, true),
  }
}

const PARSERS: { [A in GatewayAction]: (body: Body) => RequestOf<A> } = {
  SEARCH_TASK: parseSearchTask,
  SUBMIT_TIMESHEET: parseSubmitTimesheet,
  FIND_TIMESHEETS: parseFindTimesheets,
  GET_TASK: parseGetTask,
  GET_MY_TASKS: parseGetMyTasks,
  GET_TIMESHEET_HISTORY: parseGetTimesheetHistory,
  UPDATE_TIMESHEET: parseUpdateTimesheet,
  DELETE_TIMESHEET: parseDeleteTimesheet,
  SEARCH_TASKS: parseSearchTasks,
  SEARCH_TICKETS: parseSearchTickets,
  LOG_TICKET_TIME: parseLogTicketTime,
  LIST_PROJECTS: parseListProjects,
  LIST_PROJECT_TASKS: parseListProjectTasks,
  UPDATE_TASK: parseUpdateTask,
  POST_TASK_NOTE: parsePostTaskNote,
  GET_TIME_OFF: parseGetTimeOff,
  REQUEST_TIME_OFF: parseRequestTimeOff,
  UPDATE_TIME_OFF: parseUpdateTimeOff,
  DELETE_TIME_OFF: parseDeleteTimeOff,
  GET_ATTENDANCE: parseGetAttendance,
  CHECK_IN_OUT: parseCheckInOut,
  LIST_TASKS: parseListTasks,
  LIST_ASSIGNEES: parseListAssignees,
}

function isGatewayAction(value: unknown): value is GatewayAction {
  // Own keys only: "toString" or "__proto__" aren't actions.
  return typeof value === "string" && Object.hasOwn(PARSERS, value)
}

export function parseRequest(body: unknown): GatewayRequest {
  if (!isRecord(body)) {
    throw new HttpError("Request body must be a JSON object.", 400)
  }
  if (isGatewayAction(body.action)) {
    return PARSERS[body.action](body)
  }
  throw new HttpError(
    'Unknown action. Use "SEARCH_TASK", "SUBMIT_TIMESHEET", "FIND_TIMESHEETS", "GET_TASK", "GET_MY_TASKS", "GET_TIMESHEET_HISTORY", "UPDATE_TIMESHEET", "DELETE_TIMESHEET", "SEARCH_TASKS", "SEARCH_TICKETS", "LOG_TICKET_TIME", "LIST_PROJECTS", "LIST_PROJECT_TASKS", "UPDATE_TASK", "POST_TASK_NOTE", "LIST_TASKS", "LIST_ASSIGNEES", "GET_TIME_OFF", "REQUEST_TIME_OFF", "DELETE_TIME_OFF", "GET_ATTENDANCE" or "CHECK_IN_OUT".',
    400
  )
}
