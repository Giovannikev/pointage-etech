/**
 * odoo-gateway — Supabase Edge Function (Deno)
 *
 * Bridges the dashboard to the signed-in user's Odoo instances through
 * Odoo's JSON-RPC API, with the credentials stored in their settings.
 *
 * Actions (POST body):
 *   { action: "SEARCH_TASK", taskRefs: string[] }
 *   { action: "SUBMIT_TIMESHEET", entries: TimesheetSubmission[] }
 *   { action: "FIND_TIMESHEETS", lookups: TimesheetLookup[] }
 *   { action: "GET_TASK", instanceIndex, taskId }
 */
import { HttpError } from "../_shared/errors.ts"
import { readJsonBody, serveJson } from "../_shared/http.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import {
  type InstanceIndex,
  type OdooInstanceSettings,
  requireOdooInstances,
} from "../_shared/settings.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import {
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from "../_shared/validation.ts"

/* ------------------------------------------------------------------ */
/* Contract — mirrors src/types/timesheet.ts                           */
/* ------------------------------------------------------------------ */

interface TaskMatch {
  taskId: number
  taskName: string
  projectId: number
  projectName: string
  instanceIndex: InstanceIndex
}

type TaskSearchResult =
  | ({ taskRef: string; found: true } & TaskMatch)
  | { taskRef: string; found: false }

interface TimesheetSubmission {
  clientId: string
  taskId: number
  projectId: number
  hours: number
  description: string
  date: string
  instanceIndex: InstanceIndex
}

type SubmissionResult =
  | { clientId: string; success: true; timesheetId: number }
  | { clientId: string; success: false; error: string }

interface TimesheetLookup {
  instanceIndex: InstanceIndex
  taskId: number
  date: string
}

interface LoggedTimesheet extends TimesheetLookup {
  timesheetId: number
  hours: number
  description: string
}

interface TaskReference {
  instanceIndex: InstanceIndex
  taskId: number
}

interface TaskDetails {
  taskId: number
  name: string
  /** The task description as stored by Odoo; the dashboard sanitizes it. */
  descriptionHtml: string
  projectName: string | null
  stageName: string | null
}

type GatewayRequest =
  | { action: "SEARCH_TASK"; taskRefs: string[] }
  | { action: "SUBMIT_TIMESHEET"; entries: TimesheetSubmission[] }
  | { action: "FIND_TIMESHEETS"; lookups: TimesheetLookup[] }
  | ({ action: "GET_TASK" } & TaskReference)

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

const MAX_ITEMS_PER_REQUEST = 100
/** A month of commits can touch more task and day pairs than a submission. */
const MAX_LOOKUPS_PER_REQUEST = 500
const TIMESHEET_LOOKUP_LIMIT = 2_000
const MAX_TASK_REF_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 2_000
const TASK_CANDIDATE_LIMIT = 20
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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

function parseRequest(body: unknown): GatewayRequest {
  if (!isRecord(body)) {
    throw new HttpError("Request body must be a JSON object.", 400)
  }

  if (body.action === "SEARCH_TASK") {
    const taskRefs = readBatch(body.taskRefs, "taskRefs").map((ref) => {
      if (!isNonEmptyString(ref, MAX_TASK_REF_LENGTH)) {
        throw new HttpError("Every task reference must be a short string.", 400)
      }
      return ref.trim()
    })
    return { action: "SEARCH_TASK", taskRefs: [...new Set(taskRefs)] }
  }

  if (body.action === "SUBMIT_TIMESHEET") {
    const entries = readBatch(body.entries, "entries").map(parseSubmission)
    return { action: "SUBMIT_TIMESHEET", entries }
  }

  if (body.action === "GET_TASK") {
    if (
      !isInstanceIndex(body.instanceIndex) ||
      !isPositiveInteger(body.taskId)
    ) {
      throw new HttpError('"instanceIndex" and "taskId" are required.', 400)
    }
    return {
      action: "GET_TASK",
      instanceIndex: body.instanceIndex,
      taskId: body.taskId,
    }
  }

  if (body.action === "FIND_TIMESHEETS") {
    const lookups = readBatch(
      body.lookups,
      "lookups",
      MAX_LOOKUPS_PER_REQUEST
    ).map(parseLookup)
    return { action: "FIND_TIMESHEETS", lookups }
  }

  throw new HttpError(
    'Unknown action. Use "SEARCH_TASK", "SUBMIT_TIMESHEET", "FIND_TIMESHEETS" or "GET_TASK".',
    400
  )
}

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

/** Looks each reference up in instance 1, then the still missing ones in instance 2. */
async function searchTasks(
  instances: OdooInstanceSettings[],
  taskRefs: string[]
): Promise<TaskSearchResult[]> {
  const getSession = createSessionPool(instances)
  const matches = new Map<string, TaskMatch>()
  let pending = taskRefs

  for (const { index } of instances) {
    if (pending.length === 0) {
      break
    }
    const session = await getSession(index)
    const found = await Promise.all(
      pending.map((taskRef) => findTask(session, index, taskRef))
    )
    found.forEach((match, position) => {
      if (match !== null) {
        matches.set(pending[position], match)
      }
    })
    pending = pending.filter((taskRef) => !matches.has(taskRef))
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

async function createTimesheet(
  session: OdooSession,
  entry: TimesheetSubmission
): Promise<SubmissionResult> {
  try {
    const timesheetId = await executeKw(
      session,
      "account.analytic.line",
      "create",
      [
        {
          name: entry.description,
          project_id: entry.projectId,
          task_id: entry.taskId,
          unit_amount: entry.hours,
          date: entry.date,
        },
      ]
    )
    if (!isPositiveInteger(timesheetId)) {
      return {
        clientId: entry.clientId,
        success: false,
        error: "Odoo didn't return the new timesheet id.",
      }
    }
    return { clientId: entry.clientId, success: true, timesheetId }
  } catch (error) {
    if (error instanceof OdooRpcError) {
      return { clientId: entry.clientId, success: false, error: error.message }
    }
    throw error
  }
}

async function submitTimesheets(
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
  }
}

/** The signed-in user's own timesheets on the requested tasks and days. */
async function findTimesheets(
  instances: OdooInstanceSettings[],
  lookups: TimesheetLookup[]
): Promise<LoggedTimesheet[]> {
  const getSession = createSessionPool(instances)
  const wanted = new Set(lookups.map(lookupKey))
  const timesheets: LoggedTimesheet[] = []

  for (const index of new Set(lookups.map((lookup) => lookup.instanceIndex))) {
    const instanceLookups = lookups.filter((l) => l.instanceIndex === index)
    const taskIds = [...new Set(instanceLookups.map((l) => l.taskId))]
    const dates = instanceLookups.map((l) => l.date).sort()
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
        fields: ["task_id", "date", "unit_amount", "name"],
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
  }
  return timesheets
}

/* ------------------------------------------------------------------ */
/* GET_TASK                                                            */
/* ------------------------------------------------------------------ */

async function getTask(
  instances: OdooInstanceSettings[],
  { instanceIndex, taskId }: TaskReference
): Promise<TaskDetails> {
  const session = await createSessionPool(instances)(instanceIndex)
  const records = await executeKw(session, "project.task", "read", [[taskId]], {
    fields: ["name", "description", "project_id", "stage_id"],
  })
  const record = Array.isArray(records) ? records[0] : undefined
  if (!isRecord(record) || typeof record.name !== "string") {
    throw new HttpError("This task can't be read in Odoo.", 404)
  }
  return {
    taskId,
    name: record.name,
    descriptionHtml:
      typeof record.description === "string" ? record.description : "",
    projectName: readMany2one(record.project_id)?.name ?? null,
    stageName: readMany2one(record.stage_id)?.name ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

serveJson("odoo-gateway", {
  POST: async ({ request, userId }) => {
    const gatewayRequest = parseRequest(await readJsonBody(request))
    const instances = requireOdooInstances(await loadSettings(userId))
    switch (gatewayRequest.action) {
      case "SEARCH_TASK":
        return {
          results: await searchTasks(instances, gatewayRequest.taskRefs),
        }
      case "SUBMIT_TIMESHEET":
        return {
          results: await submitTimesheets(instances, gatewayRequest.entries),
        }
      case "FIND_TIMESHEETS":
        return {
          results: await findTimesheets(instances, gatewayRequest.lookups),
        }
      case "GET_TASK":
        return { task: await getTask(instances, gatewayRequest) }
    }
  },
})
