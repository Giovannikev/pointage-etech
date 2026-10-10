import {
  InvalidResponseError,
  invokeFunction,
} from "@/services/edgeFunctionClient"
import type {
  GatewayRequest,
  LoggedTimesheet,
  OdooInstanceIndex,
  SubmissionResult,
  TaskDetails,
  TaskSearchResult,
  TimesheetLookup,
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
export function submitTimesheets(
  entries: TimesheetSubmission[]
): Promise<SubmissionResult[]> {
  return inBatches(entries, MAX_ITEMS_PER_REQUEST, async (batch) =>
    readResults(
      await invokeGateway({ action: "SUBMIT_TIMESHEET", entries: batch })
    ).map(toSubmissionResult)
  )
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
