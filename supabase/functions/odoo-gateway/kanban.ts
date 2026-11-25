import { HttpError } from "../_shared/errors.ts"
import { executeKw, type OdooSession, readMany2one } from "../_shared/odoo.ts"
import { getModelFields } from "../_shared/odooFields.ts"
import type { InstanceIndex } from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import {
  KANBAN_TASK_STATUSES,
  type KanbanStage,
  type KanbanTask,
  type KanbanTaskStatus,
} from "./contract.ts"
import { readDeadline, readNumber, readRecords } from "./helpers.ts"

/* ------------------------------------------------------------------ */
/* project.task fields and the board's tasks and stages                */
/* ------------------------------------------------------------------ */

/**
 * project.task fields differ between Odoo versions:
 * - user_id (single assignee) was replaced by user_ids in Odoo 15;
 * - kanban_state was replaced by state in Odoo 17;
 * - planned_hours was renamed allocated_hours in Odoo 17;
 * - effective_hours only exists when Timesheets (hr_timesheet) is installed.
 * Asking search_read for a missing field fails, so the fields are detected
 * first and only the existing ones are requested.
 */
export interface TaskFieldSupport {
  assigneeDomain: unknown[]
  /** Holds the assignees: user_ids from Odoo 15, user_id before. */
  assigneeField: "user_ids" | "user_id"
  fields: string[]
  plannedField: "allocated_hours" | "planned_hours" | null
  statusField: "kanban_state" | "state" | null
  hasEffectiveHours: boolean
}

const BASE_TASK_FIELDS = [
  "id",
  "name",
  "project_id",
  "stage_id",
  "priority",
  "date_deadline",
]

export async function detectTaskFields(
  session: OdooSession
): Promise<TaskFieldSupport> {
  const available = await getModelFields(session, "project.task")
  const has = (field: string): boolean => available.has(field)
  const { uid } = session

  let assigneeDomain: unknown[]
  if (has("user_id") && has("user_ids")) {
    assigneeDomain = [
      "&",
      ["active", "=", true],
      "|",
      ["user_id", "=", uid],
      ["user_ids", "in", [uid]],
    ]
  } else if (has("user_ids")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_ids", "in", [uid]],
    ]
  } else if (has("user_id")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_id", "=", uid],
    ]
  } else {
    throw new HttpError(
      `${session.connection.label} has no task assignee field.`,
      502
    )
  }

  const plannedField = has("allocated_hours")
    ? "allocated_hours"
    : has("planned_hours")
      ? "planned_hours"
      : null
  const statusField = has("kanban_state")
    ? "kanban_state"
    : has("state")
      ? "state"
      : null
  const hasEffectiveHours = has("effective_hours")
  const assigneeField = has("user_ids") ? "user_ids" : "user_id"

  const fields = BASE_TASK_FIELDS.filter(has)
  fields.push(assigneeField)
  if (plannedField !== null) fields.push(plannedField)
  if (statusField !== null) fields.push(statusField)
  if (hasEffectiveHours) fields.push("effective_hours")

  return {
    assigneeDomain,
    assigneeField,
    fields,
    plannedField,
    statusField,
    hasEffectiveHours,
  }
}

const KANBAN_STATE_STATUSES: Readonly<Record<string, KanbanTaskStatus>> = {
  normal: "in_progress",
  done: "approved",
  blocked: "blocked",
}

const STATE_STATUSES: Readonly<Record<string, KanbanTaskStatus>> = {
  "01_in_progress": "in_progress",
  "02_changes_requested": "changes_requested",
  "03_approved": "approved",
  "04_waiting_normal": "waiting",
  "1_done": "done",
  "1_canceled": "canceled",
}

/**
 * The value each state is written as, per status field. Only states a user
 * can pick in Odoo are listed: "waiting" (Odoo 17+) is computed from the
 * blocking tasks, so it can't be set.
 */
export const STATUS_VALUES: Readonly<
  Record<
    NonNullable<TaskFieldSupport["statusField"]>,
    Partial<Record<KanbanTaskStatus, string>>
  >
> = {
  kanban_state: {
    in_progress: "normal",
    blocked: "blocked",
    approved: "done",
  },
  state: {
    in_progress: "01_in_progress",
    changes_requested: "02_changes_requested",
    approved: "03_approved",
    done: "1_done",
    canceled: "1_canceled",
  },
}

export function statusOptions(
  field: TaskFieldSupport["statusField"]
): KanbanTaskStatus[] {
  return field === null
    ? []
    : KANBAN_TASK_STATUSES.filter(
        (status) => STATUS_VALUES[field][status] !== undefined
      )
}

function readTaskStatus(
  value: unknown,
  field: TaskFieldSupport["statusField"]
): KanbanTaskStatus | null {
  if (typeof value !== "string" || field === null) {
    return null
  }
  const statuses =
    field === "kanban_state" ? KANBAN_STATE_STATUSES : STATE_STATUSES
  return statuses[value] ?? null
}

export function readKanbanTask(
  record: unknown,
  instanceIndex: InstanceIndex,
  support: TaskFieldSupport
): KanbanTask | null {
  if (
    !isRecord(record) ||
    !isPositiveInteger(record.id) ||
    typeof record.name !== "string"
  ) {
    return null
  }
  const project = readMany2one(record.project_id)
  const stage = readMany2one(record.stage_id)
  const priority = Number(record.priority)
  const planned =
    support.plannedField === null
      ? null
      : readNumber(record[support.plannedField])

  return {
    instanceIndex,
    taskId: record.id,
    name: record.name,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    stageId: stage?.id ?? null,
    stageName: stage?.name ?? null,
    priority: Number.isInteger(priority) && priority > 0 ? priority : 0,
    deadline: readDeadline(record.date_deadline),
    status: readTaskStatus(
      support.statusField === null ? undefined : record[support.statusField],
      support.statusField
    ),
    plannedHours: planned !== null && planned > 0 ? planned : null,
    effectiveHours: support.hasEffectiveHours
      ? (readNumber(record.effective_hours) ?? 0)
      : null,
    assigneeIds: readAssigneeIds(record[support.assigneeField]),
  }
}

/** user_ids is a list of ids; user_id a many2one ([id, name] or false). */
function readAssigneeIds(value: unknown): number[] {
  if (Array.isArray(value) && value.every(isPositiveInteger)) {
    return value
  }
  const user = readMany2one(value)
  return user === null ? [] : [user.id]
}

function readKanbanStage(
  record: unknown,
  instanceIndex: InstanceIndex
): KanbanStage | null {
  if (
    !isRecord(record) ||
    !isPositiveInteger(record.id) ||
    typeof record.name !== "string"
  ) {
    return null
  }
  return {
    instanceIndex,
    stageId: record.id,
    name: record.name,
    sequence: readNumber(record.sequence) ?? 0,
    folded: record.fold === true,
    projectIds: Array.isArray(record.project_ids)
      ? record.project_ids.filter(isPositiveInteger)
      : [],
  }
}

/** The stages of the tasks' projects, plus any stage a task sits in. */
export async function readStages(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  tasks: KanbanTask[]
): Promise<KanbanStage[]> {
  const projectIds = [...new Set(tasks.flatMap((task) => task.projectId ?? []))]
  const stageIds = [...new Set(tasks.flatMap((task) => task.stageId ?? []))]
  if (projectIds.length === 0 && stageIds.length === 0) {
    return []
  }

  const records = await executeKw(
    session,
    "project.task.type",
    "search_read",
    [["|", ["id", "in", stageIds], ["project_ids", "in", projectIds]]],
    {
      fields: ["id", "name", "sequence", "fold", "project_ids"],
      order: "sequence asc, id asc",
    }
  )
  return readRecords(records, session, "stage").flatMap(
    (record) => readKanbanStage(record, instanceIndex) ?? []
  )
}

/** Reads one task as the board shows it. */
export async function readOneTask(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  taskId: number,
  support: TaskFieldSupport
): Promise<KanbanTask> {
  const records = await executeKw(session, "project.task", "read", [[taskId]], {
    fields: support.fields,
  })
  const task = readKanbanTask(
    Array.isArray(records) ? records[0] : undefined,
    instanceIndex,
    support
  )
  if (task === null) {
    throw new HttpError("This task can't be read in Odoo.", 404)
  }
  return task
}
