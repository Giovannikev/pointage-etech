import { cacheKey, odooCache, type CacheKey } from "@/lib/odooCache"
import {
  InvalidResponseError,
  invokeFunction,
} from "@/services/edgeFunctionClient"
import type {
  AssigneesInstanceResult,
  CommitPeriod,
  GatewayRequest,
  InstanceResult,
  MyTasksInstanceResult,
  OdooInstanceIndex,
  RecordFilters,
  TimesheetHistoryInstanceResult,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

export const GATEWAY_FUNCTION = "odoo-gateway"
/** Mirror the per-request limits of the odoo-gateway Edge Function. */
export const MAX_ITEMS_PER_REQUEST = 100
export const MAX_LOOKUPS_PER_REQUEST = 500

export function invokeGateway(request: GatewayRequest): Promise<unknown> {
  return invokeFunction(GATEWAY_FUNCTION, { body: request })
}

/** Sends items in consecutive requests of at most `size`, so long periods fit the limits. */
export async function inBatches<T, R>(
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

export function readResults(data: unknown): unknown[] {
  if (isRecord(data) && Array.isArray(data.results)) {
    return data.results
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

export function isInstanceIndex(value: unknown): value is OdooInstanceIndex {
  return value === 1 || value === 2
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

export const MY_TASKS_TTL_MS = 5 * 60_000
export const HISTORY_TTL_MS = 2 * 60_000
export const SEARCH_TTL_MS = 60_000
export const PROJECTS_TTL_MS = 10 * 60_000

export const MY_TASKS_KEY: CacheKey<MyTasksInstanceResult[]> =
  cacheKey("myTasks")
const HISTORY_PREFIX = "history:"
export const TASK_SEARCH_PREFIX = "taskSearch:"
export const TICKETS_PREFIX = "tickets:"
export const PROJECTS_PREFIX = "projects:"
export const PROJECT_TASKS_PREFIX = "projectTasks:"
export const TASK_LIST_PREFIX = "taskList:"
export const ASSIGNEES_KEY: CacheKey<AssigneesInstanceResult[]> =
  cacheKey("assignees")

export function historyKey(
  period: CommitPeriod
): CacheKey<TimesheetHistoryInstanceResult[]> {
  return cacheKey(`${HISTORY_PREFIX}${period.from}:${period.to}`)
}

/** Forgets every cached Odoo read, e.g. after the settings changed. */
export function clearOdooCache(): void {
  odooCache.clear()
}

/** Timesheets changed in Odoo: logged hours everywhere are stale. */
export function invalidateTimesheetReads(): void {
  odooCache.invalidate(HISTORY_PREFIX)
  odooCache.invalidate(MY_TASKS_KEY.id)
  odooCache.invalidate(TASK_SEARCH_PREFIX)
  odooCache.invalidate(TASK_LIST_PREFIX)
  odooCache.invalidate(TICKETS_PREFIX)
}

/** Every list showing tasks may hold the old stage or state. */
export function invalidateTaskReads(): void {
  odooCache.invalidate(MY_TASKS_KEY.id)
  odooCache.invalidate(TASK_SEARCH_PREFIX)
  odooCache.invalidate(TASK_LIST_PREFIX)
  odooCache.invalidate(PROJECT_TASKS_PREFIX)
}

/** Normalized so "Daily" and " daily " share one cache entry. */
export function searchKey(prefix: string, query: string): string {
  return `${prefix}${query.trim().toLocaleLowerCase()}`
}

export const NO_FILTERS: RecordFilters = { projects: [], assignees: [] }

/** Same filters, same text: the order of the keys doesn't matter. */
export function filtersKey({ projects, assignees }: RecordFilters): string {
  return `${[...projects].sort().join(",")}|${[...assignees].sort().join(",")}`
}

/* ------------------------------------------------------------------ */
/* Response parsing shared by the per-instance actions                 */
/* ------------------------------------------------------------------ */

export function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

export function isNullableId(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value)
}

export function readInstanceResults(data: unknown): unknown[] {
  if (isRecord(data) && Array.isArray(data.instances)) {
    return data.instances
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

export function toInstanceResult<T>(
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

export function readList<T>(
  value: unknown,
  readItem: (item: unknown) => T
): T[] {
  if (!Array.isArray(value)) {
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  }
  return value.map(readItem)
}
