import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import { getModelFields } from "../_shared/odooFields.ts"
import type {
  InstanceIndex,
  OdooInstanceSettings,
} from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import type {
  HelpdeskTicket,
  TicketQuery,
  TicketsInstanceResult,
  TicketTimeEntry,
} from "./contract.ts"
import { findTicketLinkField, type TicketLinkField } from "./fields.ts"
import { filterDomainFor, hasRecordFilters } from "./filters.ts"
import {
  anyOf,
  asConflict,
  readEachInstance,
  readIdQuery,
  readNumber,
  readRecords,
  SEARCH_LIMIT,
  selectInstances,
} from "./helpers.ts"
import { createTimesheetLine } from "./timesheets.ts"

const MY_TICKETS_LIMIT = 200
/** Filtered tickets can be many more than a search returns. */
const FILTERED_TICKETS_LIMIT = 200

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

export function searchTickets(
  instances: OdooInstanceSettings[],
  { query, mine, instanceIndex, filters }: TicketQuery
): Promise<TicketsInstanceResult[]> {
  const isFiltered = hasRecordFilters(filters)
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTicketFields(session)
      if (support === null) {
        return { available: false, tickets: [], truncated: false }
      }
      const filterDomain = filterDomainFor(filters, index, {
        projectField: support.fields.includes("project_id")
          ? "project_id"
          : null,
        assigneeField: "user_id",
      })
      // The filters leave nothing to read on this instance.
      if (filterDomain === null) {
        return { available: true, tickets: [], truncated: false }
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
      const limit = mine
        ? MY_TICKETS_LIMIT
        : isFiltered
          ? FILTERED_TICKETS_LIMIT
          : SEARCH_LIMIT
      const records = await executeKw(
        session,
        TICKET_MODEL,
        "search_read",
        [
          [
            ...support.openDomain,
            ...(mine ? [["user_id", "=", session.uid]] : []),
            ...filterDomain,
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
export async function logTicketTime(
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
    createTimesheetLine(session, {
      name: entry.description,
      project_id: ticket.projectId,
      [support.lineLink]: entry.ticketId,
      ...(task === null ? {} : { task_id: task.id }),
      unit_amount: entry.hours,
      date: entry.date,
    })
  )
  if (!isPositiveInteger(timesheetId)) {
    throw new HttpError("Odoo didn't return the new timesheet id.", 502)
  }
  return { timesheetId }
}
