import {
  odooCache,
  type CacheKey,
  type CacheReadOptions,
  cacheKey,
} from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  GATEWAY_FUNCTION,
  NO_FILTERS,
  SEARCH_TTL_MS,
  TICKETS_PREFIX,
  filtersKey,
  invalidateTimesheetReads,
  invokeGateway,
  isInstanceIndex,
  isNullableId,
  isNullableNumber,
  isNullableString,
  readInstanceResults,
  readList,
  searchKey,
  toInstanceResult,
} from "@/services/odoo/shared"
import type {
  HelpdeskTicket,
  OdooInstanceIndex,
  RecordFilters,
  TicketsInstanceResult,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

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
