import {
  cacheKey,
  odooCache,
  type CacheKey,
  type CacheReadOptions,
} from "@/lib/odooCache"
import {
  InvalidResponseError,
  invokeFunction,
} from "@/services/edgeFunctionClient"
import type {
  CommitPeriod,
  GatewayRequest,
  InstanceResult,
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  LoggedTimesheet,
  MyTasksInstanceResult,
  OdooInstanceIndex,
  SubmissionResult,
  TaskDetails,
  TaskSearchResult,
  TimesheetChanges,
  TimesheetHistoryEntry,
  TimesheetHistoryInstanceResult,
  TimesheetLookup,
  TimesheetReference,
  TimesheetSubmission,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

const GATEWAY_FUNCTION = "odoo-gateway"
/** Mirror the per-request limits of the odoo-gateway Edge Function. */
const MAX_ITEMS_PER_REQUEST = 100
const MAX_LOOKUPS_PER_REQUEST = 500

function invokeGateway(request: GatewayRequest): Promise<unknown> {
  return invokeFunction(GATEWAY_FUNCTION, { body: request })
}

/** Sends items in consecutive requests of at most `size`, so long periods fit the limits. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  send: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await send(items.slice(start, start + size))))
  }
  return results
}

function readResults(data: unknown): unknown[] {
  if (isRecord(data) && Array.isArray(data.results)) {
    return data.results
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function isInstanceIndex(value: unknown): value is OdooInstanceIndex {
  return value === 1 || value === 2
}

function toTaskSearchResult(value: unknown): TaskSearchResult {
  if (!isRecord(value) || typeof value.taskRef !== "string") {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
  if (value.found === false) {
    return { taskRef: value.taskRef, found: false }
  }
  if (
    value.found === true &&
    isPositiveInteger(value.taskId) &&
    typeof value.taskName === "string" &&
    isPositiveInteger(value.projectId) &&
    typeof value.projectName === "string" &&
    isInstanceIndex(value.instanceIndex)
  ) {
    return {
      taskRef: value.taskRef,
      found: true,
      taskId: value.taskId,
      taskName: value.taskName,
      projectId: value.projectId,
      projectName: value.projectName,
      instanceIndex: value.instanceIndex,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toSubmissionResult(value: unknown): SubmissionResult {
  if (!isRecord(value) || typeof value.clientId !== "string") {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
  if (value.success === true && isPositiveInteger(value.timesheetId)) {
    return {
      clientId: value.clientId,
      success: true,
      timesheetId: value.timesheetId,
    }
  }
  if (value.success === false && typeof value.error === "string") {
    return { clientId: value.clientId, success: false, error: value.error }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toLoggedTimesheet(value: unknown): LoggedTimesheet {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.taskId) &&
    typeof value.date === "string" &&
    isPositiveInteger(value.timesheetId) &&
    typeof value.hours === "number" &&
    typeof value.description === "string"
  ) {
    return {
      instanceIndex: value.instanceIndex,
      taskId: value.taskId,
      date: value.date,
      timesheetId: value.timesheetId,
      hours: value.hours,
      description: value.description,
      // Older gateways don't send it: unknown means not locked.
      locked: value.locked === true,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

/** Looks each task reference up in the user's Odoo instance 1, then instance 2. */
export function searchTasks(taskRefs: string[]): Promise<TaskSearchResult[]> {
  return inBatches(taskRefs, MAX_ITEMS_PER_REQUEST, async (batch) =>
    readResults(
      await invokeGateway({ action: "SEARCH_TASK", taskRefs: batch })
    ).map(toTaskSearchResult)
  )
}

/** Creates the timesheet lines in their Odoo instance; results are per entry. */
export async function submitTimesheets(
  entries: TimesheetSubmission[]
): Promise<SubmissionResult[]> {
  try {
    return await inBatches(entries, MAX_ITEMS_PER_REQUEST, async (batch) =>
      readResults(
        await invokeGateway({ action: "SUBMIT_TIMESHEET", entries: batch })
      ).map(toSubmissionResult)
    )
  } finally {
    // Even a partial failure may have created lines.
    invalidateTimesheetReads()
  }
}

/** The signed-in user's existing timesheets on these tasks and days. */
export function findLoggedTimesheets(
  lookups: TimesheetLookup[]
): Promise<LoggedTimesheet[]> {
  return inBatches(lookups, MAX_LOOKUPS_PER_REQUEST, async (batch) =>
    readResults(
      await invokeGateway({ action: "FIND_TIMESHEETS", lookups: batch })
    ).map(toLoggedTimesheet)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

export async function fetchTaskDetails(
  instanceIndex: OdooInstanceIndex,
  taskId: number
): Promise<TaskDetails> {
  const data = await invokeGateway({
    action: "GET_TASK",
    instanceIndex,
    taskId,
  })
  const task = isRecord(data) ? data.task : null
  if (
    isRecord(task) &&
    isPositiveInteger(task.taskId) &&
    typeof task.name === "string" &&
    typeof task.descriptionHtml === "string" &&
    isNullableString(task.projectName) &&
    isNullableString(task.stageName)
  ) {
    return {
      taskId: task.taskId,
      name: task.name,
      descriptionHtml: task.descriptionHtml,
      projectName: task.projectName,
      stageName: task.stageName,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const MY_TASKS_TTL_MS = 5 * 60_000
const HISTORY_TTL_MS = 2 * 60_000

const MY_TASKS_KEY: CacheKey<MyTasksInstanceResult[]> = cacheKey("myTasks")
const HISTORY_PREFIX = "history:"

function historyKey(
  period: CommitPeriod
): CacheKey<TimesheetHistoryInstanceResult[]> {
  return cacheKey(`${HISTORY_PREFIX}${period.from}:${period.to}`)
}

/** Forgets every cached Odoo read, e.g. after the settings changed. */
export function clearOdooCache(): void {
  odooCache.clear()
}

/** Timesheets changed in Odoo: hours on tasks and the history are stale. */
function invalidateTimesheetReads(): void {
  odooCache.invalidate(HISTORY_PREFIX)
  odooCache.invalidate(MY_TASKS_KEY.id)
}

/* ------------------------------------------------------------------ */
/* Response parsing shared by the per-instance actions                 */
/* ------------------------------------------------------------------ */

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isNullableId(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value)
}

function readInstanceResults(data: unknown): unknown[] {
  if (isRecord(data) && Array.isArray(data.instances)) {
    return data.instances
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toInstanceResult<T>(
  value: unknown,
  readData: (record: Record<string, unknown>) => T
): InstanceResult<T> {
  if (!isRecord(value) || !isInstanceIndex(value.instanceIndex)) {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
  if (value.ok === false && typeof value.error === "string") {
    return { instanceIndex: value.instanceIndex, ok: false, error: value.error }
  }
  if (value.ok === true) {
    return { instanceIndex: value.instanceIndex, ok: true, ...readData(value) }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function readList<T>(value: unknown, readItem: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
  return value.map(readItem)
}

/* ------------------------------------------------------------------ */
/* GET_MY_TASKS                                                        */
/* ------------------------------------------------------------------ */

const KANBAN_STATUSES: readonly KanbanTaskStatus[] = [
  "in_progress",
  "changes_requested",
  "approved",
  "done",
  "canceled",
  "waiting",
  "blocked",
]

function isKanbanStatus(value: unknown): value is KanbanTaskStatus {
  return KANBAN_STATUSES.some((status) => status === value)
}

function toKanbanTask(value: unknown): KanbanTask {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.taskId) &&
    typeof value.name === "string" &&
    isNullableId(value.projectId) &&
    isNullableString(value.projectName) &&
    isNullableId(value.stageId) &&
    isNullableString(value.stageName) &&
    typeof value.priority === "number" &&
    isNullableString(value.deadline) &&
    (value.status === null || isKanbanStatus(value.status)) &&
    isNullableNumber(value.plannedHours) &&
    isNullableNumber(value.effectiveHours)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      taskId: value.taskId,
      name: value.name,
      projectId: value.projectId,
      projectName: value.projectName,
      stageId: value.stageId,
      stageName: value.stageName,
      priority: value.priority,
      deadline: value.deadline,
      status: value.status,
      plannedHours: value.plannedHours,
      effectiveHours: value.effectiveHours,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toKanbanStage(value: unknown): KanbanStage {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.stageId) &&
    typeof value.name === "string" &&
    typeof value.sequence === "number" &&
    typeof value.folded === "boolean"
  ) {
    return {
      instanceIndex: value.instanceIndex,
      stageId: value.stageId,
      name: value.name,
      sequence: value.sequence,
      folded: value.folded,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toMyTasksResult(value: unknown): MyTasksInstanceResult {
  return toInstanceResult(value, (record) => ({
    tasks: readList(record.tasks, toKanbanTask),
    stages: readList(record.stages, toKanbanStage),
    truncated: record.truncated === true,
  }))
}

/** Cached for a few minutes; pass `force` to read Odoo again. */
export function fetchMyTasks(
  options: CacheReadOptions = {}
): Promise<MyTasksInstanceResult[]> {
  return odooCache.getOrFetch(
    MY_TASKS_KEY,
    MY_TASKS_TTL_MS,
    async () =>
      readInstanceResults(await invokeGateway({ action: "GET_MY_TASKS" })).map(
        toMyTasksResult
      ),
    options
  )
}

/** The cached tasks, if fresh: lets a page render without a loading state. */
export function peekMyTasks(): MyTasksInstanceResult[] | undefined {
  return odooCache.peek(MY_TASKS_KEY)
}

/* ------------------------------------------------------------------ */
/* GET_TIMESHEET_HISTORY                                               */
/* ------------------------------------------------------------------ */

function toHistoryEntry(value: unknown): TimesheetHistoryEntry {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.timesheetId) &&
    typeof value.date === "string" &&
    typeof value.description === "string" &&
    typeof value.hours === "number" &&
    isNullableId(value.projectId) &&
    isNullableString(value.projectName) &&
    isNullableId(value.taskId) &&
    isNullableString(value.taskName)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      timesheetId: value.timesheetId,
      date: value.date,
      description: value.description,
      hours: value.hours,
      projectId: value.projectId,
      projectName: value.projectName,
      taskId: value.taskId,
      taskName: value.taskName,
      locked: value.locked === true,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toHistoryResult(value: unknown): TimesheetHistoryInstanceResult {
  return toInstanceResult(value, (record) => ({
    entries: readList(record.entries, toHistoryEntry),
    truncated: record.truncated === true,
  }))
}

/** The user's timesheets of the period in every instance; cached briefly. */
export function fetchTimesheetHistory(
  period: CommitPeriod,
  options: CacheReadOptions = {}
): Promise<TimesheetHistoryInstanceResult[]> {
  return odooCache.getOrFetch(
    historyKey(period),
    HISTORY_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({
          action: "GET_TIMESHEET_HISTORY",
          dateFrom: period.from,
          dateTo: period.to,
        })
      ).map(toHistoryResult),
    options
  )
}

export function peekTimesheetHistory(
  period: CommitPeriod
): TimesheetHistoryInstanceResult[] | undefined {
  return odooCache.peek(historyKey(period))
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/** Logs time on one task (Kanban quick log). */
export async function logTime(
  submission: TimesheetSubmission
): Promise<number> {
  const [result] = await submitTimesheets([submission])
  if (result === undefined) {
    throw new Error("Odoo didn't return a result for this line.")
  }
  if (!result.success) {
    throw new Error(result.error)
  }
  return result.timesheetId
}

/** Changes the hours and description of one of the user's timesheets. */
export async function updateTimesheet(
  reference: TimesheetReference,
  changes: TimesheetChanges
): Promise<TimesheetHistoryEntry> {
  const data = await invokeGateway({
    action: "UPDATE_TIMESHEET",
    instanceIndex: reference.instanceIndex,
    timesheetId: reference.timesheetId,
    hours: changes.hours,
    description: changes.description.trim(),
  })
  invalidateTimesheetReads()
  if (isRecord(data)) {
    return toHistoryEntry(data.timesheet)
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

/** Deletes one of the user's timesheets in Odoo. */
export async function deleteTimesheet(
  reference: TimesheetReference
): Promise<void> {
  const data = await invokeGateway({
    action: "DELETE_TIMESHEET",
    instanceIndex: reference.instanceIndex,
    timesheetId: reference.timesheetId,
  })
  invalidateTimesheetReads()
  const deleted = isRecord(data) ? data.deleted : null
  if (
    !isRecord(deleted) ||
    deleted.timesheetId !== reference.timesheetId ||
    deleted.instanceIndex !== reference.instanceIndex
  ) {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
}
