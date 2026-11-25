import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  executeKw,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import type {
  InstanceIndex,
  OdooInstanceSettings,
} from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import type {
  HistoryQuery,
  LoggedTimesheet,
  SubmissionResult,
  TaskMatch,
  TaskSearchResult,
  TimesheetHistoryEntry,
  TimesheetHistoryResult,
  TimesheetLookup,
  TimesheetReference,
  TimesheetSubmission,
  TimesheetUpdate,
} from "./contract.ts"
import { timesheetFields } from "./fields.ts"
import {
  asConflict,
  readDate,
  readEachInstance,
  readNumber,
  readRecords,
  selectInstances,
} from "./helpers.ts"

const TASK_CANDIDATE_LIMIT = 20
const TIMESHEET_LOOKUP_LIMIT = 2_000
const HISTORY_LIMIT = 2_000

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

/** Task searches sent to one instance at a time, to spare its workers. */
const SEARCH_CONCURRENCY = 10

/** Looks each reference up in instance 1, then the still missing ones in instance 2. */
export async function searchTasks(
  instances: OdooInstanceSettings[],
  taskRefs: string[]
): Promise<TaskSearchResult[]> {
  const getSession = createSessionPool(instances)
  const matches = new Map<string, TaskMatch>()
  let pending = taskRefs
  // An instance that fails (down, expired certificate) doesn't stop the
  // search in the others. Its error is raised only for references found
  // nowhere else: "not found" would then be a guess.
  let failure: unknown = null

  for (const { index } of instances) {
    if (pending.length === 0) {
      break
    }
    let session: OdooSession
    try {
      session = await getSession(index)
    } catch (error) {
      failure ??= error
      continue
    }
    for (let start = 0; start < pending.length; start += SEARCH_CONCURRENCY) {
      const batch = pending.slice(start, start + SEARCH_CONCURRENCY)
      const found = await Promise.all(
        batch.map((taskRef) =>
          findTask(session, index, taskRef).catch((error: unknown) => {
            failure ??= error
            return null
          })
        )
      )
      found.forEach((match, position) => {
        if (match !== null) {
          matches.set(batch[position], match)
        }
      })
    }
    pending = pending.filter((taskRef) => !matches.has(taskRef))
  }
  if (pending.length > 0 && failure !== null) {
    throw failure
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

/**
 * Creates a timesheet line, or returns the identical one the user already
 * has (same day, task or ticket, hours and description).
 *
 * This makes a retry safe: when a request timed out or its answer was lost
 * after Odoo had created the line, sending it again finds that line instead
 * of logging the time twice.
 */
export async function createTimesheetLine(
  session: OdooSession,
  values: Record<string, string | number>
): Promise<unknown> {
  const domain = [
    ["user_id", "=", session.uid],
    ...Object.entries(values).map(([field, value]) => [field, "=", value]),
  ]
  const existing = await executeKw(
    session,
    "account.analytic.line",
    "search",
    [domain],
    { limit: 1 }
  )
  if (Array.isArray(existing) && isPositiveInteger(existing[0])) {
    return existing[0]
  }
  return executeKw(session, "account.analytic.line", "create", [values])
}

async function createTimesheet(
  session: OdooSession,
  entry: TimesheetSubmission
): Promise<SubmissionResult> {
  try {
    const timesheetId = await createTimesheetLine(session, {
      name: entry.description,
      project_id: entry.projectId,
      task_id: entry.taskId,
      unit_amount: entry.hours,
      date: entry.date,
    })
    if (!isPositiveInteger(timesheetId)) {
      return {
        clientId: entry.clientId,
        success: false,
        error: "Odoo didn't return the new timesheet id.",
      }
    }
    return { clientId: entry.clientId, success: true, timesheetId }
  } catch (error) {
    // Any failure (Odoo error, timeout, unreachable) stays on its line, so
    // the lines already created keep their result. A retry is safe: see
    // createTimesheetLine.
    const message = error instanceof Error ? error.message : String(error)
    return { clientId: entry.clientId, success: false, error: message }
  }
}

export async function submitTimesheets(
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
export async function findTimesheets(
  instances: OdooInstanceSettings[],
  lookups: TimesheetLookup[]
): Promise<LoggedTimesheet[]> {
  const getSession = createSessionPool(instances)
  const wanted = new Set(lookups.map(lookupKey))
  const timesheets: LoggedTimesheet[] = []

  const indexes = [...new Set(lookups.map((lookup) => lookup.instanceIndex))]
  // One instance failing doesn't hide the lines of the others; its error is
  // raised only when no instance answered.
  let failure: unknown = null
  let answered = 0

  for (const index of indexes) {
    const instanceLookups = lookups.filter((l) => l.instanceIndex === index)
    const taskIds = [...new Set(instanceLookups.map((l) => l.taskId))]
    const dates = instanceLookups.map((l) => l.date).sort()
    try {
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
      answered += 1
    } catch (error) {
      failure ??= error
    }
  }
  if (answered === 0 && failure !== null) {
    throw failure
  }
  return timesheets
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

export function getTimesheetHistory(
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

export async function updateTimesheet(
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

export async function deleteTimesheet(
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
