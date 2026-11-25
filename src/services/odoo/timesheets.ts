import i18n from "i18next"
import { odooCache, type CacheReadOptions } from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  GATEWAY_FUNCTION,
  HISTORY_TTL_MS,
  MAX_ITEMS_PER_REQUEST,
  MAX_LOOKUPS_PER_REQUEST,
  historyKey,
  inBatches,
  invalidateTimesheetReads,
  invokeGateway,
  isInstanceIndex,
  isNullableId,
  isNullableString,
  readInstanceResults,
  readList,
  readResults,
  toInstanceResult,
} from "@/services/odoo/shared"
import type {
  CommitPeriod,
  LoggedTimesheet,
  OdooInstanceIndex,
  SubmissionResult,
  TimesheetChanges,
  TimesheetHistoryEntry,
  TimesheetHistoryInstanceResult,
  TimesheetLookup,
  TimesheetReference,
  TimesheetSubmission,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

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

/** Creates the timesheet lines in their Odoo instance; results are per entry. */
export async function submitTimesheets(
  entries: TimesheetSubmission[]
): Promise<SubmissionResult[]> {
  try {
    // A failing batch doesn't discard the results of the batches before it:
    // only its own lines are marked failed, and resending them is safe since
    // the gateway finds a line Odoo already created instead of duplicating it.
    return await inBatches(entries, MAX_ITEMS_PER_REQUEST, async (batch) => {
      try {
        return readResults(
          await invokeGateway({ action: "SUBMIT_TIMESHEET", entries: batch })
        ).map(toSubmissionResult)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return batch.map(({ clientId }): SubmissionResult => ({
          clientId,
          success: false,
          error: message,
        }))
      }
    })
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
    throw new Error(i18n.t("errors.noOdooResult"))
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
