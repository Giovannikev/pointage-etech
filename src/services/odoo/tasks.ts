import {
  cacheKey,
  odooCache,
  type CacheKey,
  type CacheReadOptions,
} from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  ASSIGNEES_KEY,
  GATEWAY_FUNCTION,
  MAX_ITEMS_PER_REQUEST,
  MY_TASKS_KEY,
  MY_TASKS_TTL_MS,
  PROJECTS_TTL_MS,
  SEARCH_TTL_MS,
  TASK_LIST_PREFIX,
  TASK_SEARCH_PREFIX,
  filtersKey,
  inBatches,
  invalidateTaskReads,
  invokeGateway,
  isInstanceIndex,
  isNullableId,
  isNullableNumber,
  isNullableString,
  readInstanceResults,
  readList,
  readResults,
  searchKey,
  toInstanceResult,
} from "@/services/odoo/shared"
import type {
  AssigneesInstanceResult,
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  MyTasksInstanceResult,
  OdooAssignee,
  OdooInstanceIndex,
  PostTaskNoteRequest,
  RecordFilters,
  TaskDetails,
  TaskSearchInstanceResult,
  TaskSearchResult,
  UpdateTaskRequest,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

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

/** Looks each task reference up in the user's Odoo instance 1, then instance 2. */
export function searchTasks(taskRefs: string[]): Promise<TaskSearchResult[]> {
  return inBatches(taskRefs, MAX_ITEMS_PER_REQUEST, async (batch) =>
    readResults(
      await invokeGateway({ action: "SEARCH_TASK", taskRefs: batch })
    ).map(toTaskSearchResult)
  )
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

export function toKanbanTask(value: unknown): KanbanTask {
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
    invalidateTaskReads()
  }
}

/** Posts a note in the task's chatter, and approves the task when asked. */
export async function postTaskNote(
  request: Omit<PostTaskNoteRequest, "action">
): Promise<KanbanTask> {
  try {
    const data = await invokeGateway({ action: "POST_TASK_NOTE", ...request })
    if (isRecord(data)) {
      return toKanbanTask(data.task)
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    if (request.approve) {
      invalidateTaskReads()
    }
  }
}

/* ------------------------------------------------------------------ */
/* SEARCH_TASKS                                                        */
/* ------------------------------------------------------------------ */

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
