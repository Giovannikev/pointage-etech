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
  AssigneesInstanceResult,
  CommitPeriod,
  GatewayRequest,
  InstanceResult,
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  ListProjectsResponse,
  ListProjectTasksResponse,
  LoggedTimesheet,
  MyTasksInstanceResult,
  OdooAssignee,
  OdooProject,
  OdooInstanceIndex,
  RecordFilters,
  SubmissionResult,
  TaskDetails,
  TaskSearchResult,
  TimesheetChanges,
  HelpdeskTicket,
  TaskSearchInstanceResult,
  TicketsInstanceResult,
  TimesheetHistoryEntry,
  TimesheetHistoryInstanceResult,
  TimesheetLookup,
  TimesheetReference,
  TimesheetSubmission,
  UpdateTaskRequest,
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
const SEARCH_TTL_MS = 60_000
const PROJECTS_TTL_MS = 10 * 60_000

const MY_TASKS_KEY: CacheKey<MyTasksInstanceResult[]> = cacheKey("myTasks")
const HISTORY_PREFIX = "history:"
const TASK_SEARCH_PREFIX = "taskSearch:"
const TICKETS_PREFIX = "tickets:"
const PROJECTS_PREFIX = "projects:"
const PROJECT_TASKS_PREFIX = "projectTasks:"
const TASK_LIST_PREFIX = "taskList:"
const ASSIGNEES_KEY: CacheKey<AssigneesInstanceResult[]> = cacheKey("assignees")

function historyKey(
  period: CommitPeriod
): CacheKey<TimesheetHistoryInstanceResult[]> {
  return cacheKey(`${HISTORY_PREFIX}${period.from}:${period.to}`)
}

/** Forgets every cached Odoo read, e.g. after the settings changed. */
export function clearOdooCache(): void {
  odooCache.clear()
}

/** Timesheets changed in Odoo: logged hours everywhere are stale. */
function invalidateTimesheetReads(): void {
  odooCache.invalidate(HISTORY_PREFIX)
  odooCache.invalidate(MY_TASKS_KEY.id)
  odooCache.invalidate(TASK_SEARCH_PREFIX)
  odooCache.invalidate(TASK_LIST_PREFIX)
  odooCache.invalidate(TICKETS_PREFIX)
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
    return {
      instanceIndex: value.instanceIndex,
      ok: false,
      error: value.error,
    }
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
    isNullableNumber(value.effectiveHours) &&
    (value.assigneeIds === undefined || Array.isArray(value.assigneeIds))
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
      // Older gateways don't send the assignees.
      assigneeIds: Array.isArray(value.assigneeIds)
        ? value.assigneeIds.filter(isPositiveInteger)
        : [],
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
      // Older gateways don't send the stage's projects.
      projectIds: Array.isArray(value.projectIds)
        ? value.projectIds.filter(isPositiveInteger)
        : [],
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toMyTasksResult(value: unknown): MyTasksInstanceResult {
  return toInstanceResult(value, (record) => ({
    tasks: readList(record.tasks, toKanbanTask),
    stages: readList(record.stages, toKanbanStage),
    // Older gateways don't say which states can be set.
    statusOptions: Array.isArray(record.statusOptions)
      ? record.statusOptions.filter(isKanbanStatus)
      : [],
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

/**
 * Moves a task to another stage and/or sets its state in Odoo; resolves
 * with the task as Odoo holds it afterwards. Rejects with Odoo's message
 * (access rights, a stage of another project...).
 */
export async function updateTask(
  change: Omit<UpdateTaskRequest, "action">
): Promise<KanbanTask> {
  try {
    const data = await invokeGateway({ action: "UPDATE_TASK", ...change })
    if (isRecord(data)) {
      return toKanbanTask(data.task)
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    // Every list showing tasks may hold the old stage or state.
    odooCache.invalidate(MY_TASKS_KEY.id)
    odooCache.invalidate(TASK_SEARCH_PREFIX)
    odooCache.invalidate(TASK_LIST_PREFIX)
    odooCache.invalidate(PROJECT_TASKS_PREFIX)
  }
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
      // Older gateways don't send the ticket link.
      ticketId: isPositiveInteger(value.ticketId) ? value.ticketId : null,
      ticketName:
        typeof value.ticketName === "string" ? value.ticketName : null,
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

/** A ticket and day whose existing timesheets are looked up. */
export interface TicketTimesheetLookup {
  instanceIndex: OdooInstanceIndex
  ticketId: number
  date: string
}

/**
 * The signed-in user's existing timesheets on these tickets and days, read
 * from the timesheet history (FIND_TIMESHEETS only knows tasks). Rejects
 * when an instance of the lookups can't be read.
 */
export async function findLoggedTicketTimesheets(
  lookups: TicketTimesheetLookup[]
): Promise<LoggedTimesheet[]> {
  if (lookups.length === 0) {
    return []
  }
  const dates = lookups.map((lookup) => lookup.date).sort()
  const wanted = new Set(
    lookups.map(
      (lookup) => `${lookup.instanceIndex}:${lookup.ticketId}:${lookup.date}`
    )
  )
  const instances = new Set(lookups.map((lookup) => lookup.instanceIndex))
  const results = await fetchTimesheetHistory(
    { from: dates[0], to: dates[dates.length - 1] },
    { force: true }
  )
  const timesheets: LoggedTimesheet[] = []
  for (const result of results) {
    if (!instances.has(result.instanceIndex)) continue
    if (!result.ok) {
      throw new Error(result.error)
    }
    for (const entry of result.entries) {
      if (
        entry.ticketId !== null &&
        wanted.has(`${entry.instanceIndex}:${entry.ticketId}:${entry.date}`)
      ) {
        timesheets.push({
          instanceIndex: entry.instanceIndex,
          taskId: 0,
          ticketId: entry.ticketId,
          date: entry.date,
          timesheetId: entry.timesheetId,
          hours: entry.hours,
          description: entry.description,
          locked: entry.locked,
        })
      }
    }
  }
  return timesheets
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

/* ------------------------------------------------------------------ */
/* SEARCH_TASKS                                                        */
/* ------------------------------------------------------------------ */

/** Normalized so "Daily" and " daily " share one cache entry. */
function searchKey(prefix: string, query: string): string {
  return `${prefix}${query.trim().toLocaleLowerCase()}`
}

/** Any task with a project, assigned or not; cached for a minute. */
export function searchAllTasks(
  query: string,
  options: CacheReadOptions = {}
): Promise<TaskSearchInstanceResult[]> {
  const key = cacheKey<TaskSearchInstanceResult[]>(
    searchKey(TASK_SEARCH_PREFIX, query)
  )
  return odooCache.getOrFetch(
    key,
    SEARCH_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({ action: "SEARCH_TASKS", query: query.trim() })
      ).map((value) =>
        toInstanceResult(value, (record) => ({
          tasks: readList(record.tasks, toKanbanTask),
          truncated: record.truncated === true,
        }))
      ),
    options
  )
}

export function peekTaskSearch(
  query: string
): TaskSearchInstanceResult[] | undefined {
  return odooCache.peek(
    cacheKey<TaskSearchInstanceResult[]>(searchKey(TASK_SEARCH_PREFIX, query))
  )
}

/* ------------------------------------------------------------------ */
/* SEARCH_TICKETS / LOG_TICKET_TIME                                    */
/* ------------------------------------------------------------------ */

function toHelpdeskTicket(value: unknown): HelpdeskTicket {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.ticketId) &&
    typeof value.name === "string" &&
    isNullableString(value.ref) &&
    isNullableString(value.stageName) &&
    isNullableString(value.teamName) &&
    typeof value.priority === "number" &&
    isNullableId(value.projectId) &&
    isNullableString(value.projectName) &&
    isNullableNumber(value.hoursSpent) &&
    typeof value.loggable === "boolean"
  ) {
    return {
      instanceIndex: value.instanceIndex,
      ticketId: value.ticketId,
      name: value.name,
      ref: value.ref,
      stageName: value.stageName,
      teamName: value.teamName,
      priority: value.priority,
      projectId: value.projectId,
      projectName: value.projectName,
      hoursSpent: value.hoursSpent,
      loggable: value.loggable,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

const NO_FILTERS: RecordFilters = { projects: [], assignees: [] }

/** Same filters, same text: the order of the keys doesn't matter. */
function filtersKey({ projects, assignees }: RecordFilters): string {
  return `${[...projects].sort().join(",")}|${[...assignees].sort().join(",")}`
}

function ticketsKey(
  query: string,
  mine: boolean,
  filters: RecordFilters
): CacheKey<TicketsInstanceResult[]> {
  const scope = mine ? "mine" : "all"
  // Unfiltered keys stay as they were: the boards share them.
  const filtered =
    filters.projects.length + filters.assignees.length === 0
      ? ""
      : `[${filtersKey(filters)}]`
  return cacheKey(searchKey(`${TICKETS_PREFIX}${scope}${filtered}:`, query))
}

/**
 * The user's open tickets (`mine`, query optional) or every open ticket
 * matching the query and/or the project and assignee filters. Cached for a
 * minute.
 */
export function searchTickets(
  query: string,
  mine: boolean,
  options: CacheReadOptions = {},
  filters: RecordFilters = NO_FILTERS
): Promise<TicketsInstanceResult[]> {
  return odooCache.getOrFetch(
    ticketsKey(query, mine, filters),
    SEARCH_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({
          action: "SEARCH_TICKETS",
          query: query.trim(),
          mine,
          projects: filters.projects,
          assignees: filters.assignees,
        })
      ).map((value) =>
        toInstanceResult(value, (record) => ({
          available: record.available !== false,
          tickets: readList(record.tickets, toHelpdeskTicket),
          truncated: record.truncated === true,
        }))
      ),
    options
  )
}

export function peekTickets(
  query: string,
  mine: boolean,
  filters: RecordFilters = NO_FILTERS
): TicketsInstanceResult[] | undefined {
  return odooCache.peek(ticketsKey(query, mine, filters))
}

/** Logs time on a helpdesk ticket; resolves with the new line's id. */
export async function logTicketTime(entry: {
  instanceIndex: OdooInstanceIndex
  ticketId: number
  hours: number
  description: string
  date: string
}): Promise<number> {
  try {
    const data = await invokeGateway({
      action: "LOG_TICKET_TIME",
      ...entry,
      description: entry.description.trim(),
    })
    if (isRecord(data) && isPositiveInteger(data.timesheetId)) {
      return data.timesheetId
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    invalidateTimesheetReads()
  }
}

/* ------------------------------------------------------------------ */
/* LIST_PROJECTS / LIST_PROJECT_TASKS (manual task picker)             */
/* ------------------------------------------------------------------ */

function toOdooProject(value: unknown): OdooProject {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.projectId) &&
    typeof value.name === "string" &&
    isNullableString(value.partnerName)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      projectId: value.projectId,
      name: value.name,
      partnerName: value.partnerName,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function projectsKey(
  instanceIndex: OdooInstanceIndex
): CacheKey<ListProjectsResponse> {
  return cacheKey(`${PROJECTS_PREFIX}${instanceIndex}`)
}

/** The instance's projects that accept timesheets; cached for a few minutes. */
export function fetchProjects(
  instanceIndex: OdooInstanceIndex,
  options: CacheReadOptions = {}
): Promise<ListProjectsResponse> {
  return odooCache.getOrFetch(
    projectsKey(instanceIndex),
    PROJECTS_TTL_MS,
    async () => {
      const data = await invokeGateway({
        action: "LIST_PROJECTS",
        instanceIndex,
      })
      if (!isRecord(data)) {
        throw new InvalidResponseError(GATEWAY_FUNCTION)
      }
      return {
        projects: readList(data.projects, toOdooProject),
        truncated: data.truncated === true,
      }
    },
    options
  )
}

export function peekProjects(
  instanceIndex: OdooInstanceIndex
): ListProjectsResponse | undefined {
  return odooCache.peek(projectsKey(instanceIndex))
}

function projectTasksKey(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string
): CacheKey<ListProjectTasksResponse> {
  return cacheKey(
    searchKey(`${PROJECT_TASKS_PREFIX}${instanceIndex}:${projectId}:`, query)
  )
}

/**
 * Active tasks of a project, assigned to anyone; `query` (optional) narrows
 * them in Odoo when the project has too many. Cached for a minute.
 */
export function fetchProjectTasks(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string,
  options: CacheReadOptions = {}
): Promise<ListProjectTasksResponse> {
  return odooCache.getOrFetch(
    projectTasksKey(instanceIndex, projectId, query),
    SEARCH_TTL_MS,
    async () => {
      const data = await invokeGateway({
        action: "LIST_PROJECT_TASKS",
        instanceIndex,
        projectId,
        query: query.trim(),
      })
      if (!isRecord(data)) {
        throw new InvalidResponseError(GATEWAY_FUNCTION)
      }
      return {
        tasks: readList(data.tasks, toKanbanTask),
        truncated: data.truncated === true,
      }
    },
    options
  )
}

export function peekProjectTasks(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string
): ListProjectTasksResponse | undefined {
  return odooCache.peek(projectTasksKey(instanceIndex, projectId, query))
}

export interface ProjectsInstanceResult {
  instanceIndex: OdooInstanceIndex
  /** undefined when the instance couldn't be read. */
  projects: OdooProject[] | undefined
}

/**
 * The projects of several instances, each read (and cached) on its own: an
 * instance that fails only leaves its projects out.
 */
export async function fetchProjectsOf(
  instanceIndexes: OdooInstanceIndex[],
  options: CacheReadOptions = {}
): Promise<ProjectsInstanceResult[]> {
  const results = await Promise.allSettled(
    instanceIndexes.map((index) => fetchProjects(index, options))
  )
  return results.map((result, position) => ({
    instanceIndex: instanceIndexes[position],
    projects: result.status === "fulfilled" ? result.value.projects : undefined,
  }))
}

/** The cached projects, when every instance's are fresh. */
export function peekProjectsOf(
  instanceIndexes: OdooInstanceIndex[]
): ProjectsInstanceResult[] | undefined {
  const results: ProjectsInstanceResult[] = []
  for (const instanceIndex of instanceIndexes) {
    const cached = peekProjects(instanceIndex)
    if (cached === undefined) {
      return undefined
    }
    results.push({ instanceIndex, projects: cached.projects })
  }
  return results
}

/* ------------------------------------------------------------------ */
/* LIST_TASKS / LIST_ASSIGNEES (All tasks page)                        */
/* ------------------------------------------------------------------ */

export interface TaskListFilters extends RecordFilters {
  /** Sent to Odoo as is: empty, or 2 to 100 characters. */
  query: string
  includeClosed: boolean
}

function taskListKey({
  query,
  includeClosed,
  ...filters
}: TaskListFilters): CacheKey<MyTasksInstanceResult[]> {
  return cacheKey(
    searchKey(
      `${TASK_LIST_PREFIX}${includeClosed ? "closed" : "open"}:${filtersKey(filters)}:`,
      query
    )
  )
}

/**
 * Any task of the instances, assigned to anyone, filtered in Odoo; shaped
 * like the user's own tasks so the same board shows them. Cached for a
 * minute.
 */
export function fetchTaskList(
  filters: TaskListFilters,
  options: CacheReadOptions = {}
): Promise<MyTasksInstanceResult[]> {
  return odooCache.getOrFetch(
    taskListKey(filters),
    SEARCH_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({
          action: "LIST_TASKS",
          query: filters.query.trim(),
          projects: filters.projects,
          assignees: filters.assignees,
          includeClosed: filters.includeClosed,
        })
      ).map(toMyTasksResult),
    options
  )
}

export function peekTaskList(
  filters: TaskListFilters
): MyTasksInstanceResult[] | undefined {
  return odooCache.peek(taskListKey(filters))
}

function toOdooAssignee(value: unknown): OdooAssignee {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.userId) &&
    typeof value.name === "string"
  ) {
    return {
      instanceIndex: value.instanceIndex,
      userId: value.userId,
      name: value.name,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

/** The internal users of every instance; cached for a few minutes. */
export function fetchAssignees(
  options: CacheReadOptions = {}
): Promise<AssigneesInstanceResult[]> {
  return odooCache.getOrFetch(
    ASSIGNEES_KEY,
    PROJECTS_TTL_MS,
    async () =>
      readInstanceResults(
        await invokeGateway({ action: "LIST_ASSIGNEES" })
      ).map((value) =>
        toInstanceResult(value, (record) => {
          if (!isPositiveInteger(record.currentUserId)) {
            throw new InvalidResponseError(GATEWAY_FUNCTION)
          }
          return {
            users: readList(record.users, toOdooAssignee),
            currentUserId: record.currentUserId,
            truncated: record.truncated === true,
          }
        })
      ),
    options
  )
}

export function peekAssignees(): AssigneesInstanceResult[] | undefined {
  return odooCache.peek(ASSIGNEES_KEY)
}
