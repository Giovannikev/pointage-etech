import { noteToHtml } from "../_shared/chatterNote.ts"
import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  executeKw,
  type OdooSession,
  readMany2one,
  readServerMajorVersion,
} from "../_shared/odoo.ts"
import { getModelFields } from "../_shared/odooFields.ts"
import type {
  InstanceIndex,
  OdooInstanceSettings,
} from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import type {
  AssigneesInstanceResult,
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  MyTasksResult,
  OdooAssignee,
  OdooProject,
  ProjectTaskQuery,
  TaskDetails,
  TaskListQuery,
  TaskNote,
  TaskReference,
  TaskSearchInstanceResult,
  TaskUpdate,
} from "./contract.ts"
import { filterDomainFor } from "./filters.ts"
import {
  anyOf,
  asConflict,
  readEachInstance,
  readIdQuery,
  readRecords,
  SEARCH_LIMIT,
  selectInstances,
} from "./helpers.ts"
import {
  detectTaskFields,
  readKanbanTask,
  readOneTask,
  readStages,
  STATUS_VALUES,
  statusOptions,
  type TaskFieldSupport,
} from "./kanban.ts"

const MY_TASKS_LIMIT = 1_000
const PROJECT_LIST_LIMIT = 1_000
const PROJECT_TASKS_LIMIT = 500
const TASK_LIST_LIMIT = 500
const ASSIGNEE_LIST_LIMIT = 1_000

/* ------------------------------------------------------------------ */
/* GET_TASK                                                            */
/* ------------------------------------------------------------------ */

export async function getTask(
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
/* GET_MY_TASKS                                                        */
/* ------------------------------------------------------------------ */

async function readMyTasks(
  session: OdooSession,
  instanceIndex: InstanceIndex
): Promise<{
  tasks: KanbanTask[]
  stages: KanbanStage[]
  statusOptions: KanbanTaskStatus[]
  truncated: boolean
}> {
  const support = await detectTaskFields(session)
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [support.assigneeDomain],
    {
      fields: support.fields,
      limit: MY_TASKS_LIMIT,
      order: "priority desc, id desc",
    }
  )
  const rawTasks = readRecords(records, session, "task")
  const tasks = rawTasks.flatMap(
    (record) => readKanbanTask(record, instanceIndex, support) ?? []
  )
  const stages = await readStages(session, instanceIndex, tasks)
  return {
    tasks,
    stages,
    statusOptions: statusOptions(support.statusField),
    truncated: rawTasks.length >= MY_TASKS_LIMIT,
  }
}

export function getMyTasks(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): Promise<MyTasksResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    readMyTasks
  )
}

/* ------------------------------------------------------------------ */
/* SEARCH_TASKS                                                        */
/* ------------------------------------------------------------------ */

/** Any active task with a project, assigned or not, by name, project or id. */
export function searchAllTasks(
  instances: OdooInstanceSettings[],
  query: string,
  instanceIndex: InstanceIndex | null
): Promise<TaskSearchInstanceResult[]> {
  const id = readIdQuery(query)
  const matches = anyOf([
    ["name", "ilike", query],
    ["project_id", "ilike", query],
    ...(id === null ? [] : [["id", "=", id]]),
  ])
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTaskFields(session)
      const records = await executeKw(
        session,
        "project.task",
        "search_read",
        [[["active", "=", true], ["project_id", "!=", false], ...matches]],
        {
          fields: support.fields,
          limit: SEARCH_LIMIT,
          order: "priority desc, id desc",
        }
      )
      const raw = readRecords(records, session, "task")
      return {
        tasks: raw.flatMap(
          (record) => readKanbanTask(record, index, support) ?? []
        ),
        truncated: raw.length >= SEARCH_LIMIT,
      }
    }
  )
}

/* ------------------------------------------------------------------ */
/* UPDATE_TASK (Kanban drag and drop, state menu)                      */
/* ------------------------------------------------------------------ */

/**
 * The new stage must be one of the task's project: stages are shared
 * records, and a stage of another project would hide the task from its
 * project's pipeline.
 */
async function requireProjectStage(
  session: OdooSession,
  task: KanbanTask,
  stageId: number
): Promise<void> {
  const records = await executeKw(
    session,
    "project.task.type",
    "read",
    [[stageId]],
    { fields: ["name", "project_ids"] }
  )
  const stage = Array.isArray(records) ? records[0] : undefined
  if (!isRecord(stage) || typeof stage.name !== "string") {
    throw new HttpError("This stage doesn't exist in Odoo anymore.", 404)
  }
  const projectIds = Array.isArray(stage.project_ids) ? stage.project_ids : []
  if (task.projectId === null || !projectIds.includes(task.projectId)) {
    throw new HttpError(
      `The stage "${stage.name}" isn't used by the project of this task.`,
      409
    )
  }
}

/**
 * Moves a task to another stage and/or sets its state, with the user's own
 * Odoo rights, then reads it again: Odoo may change other fields on the way
 * (moving a task resets its state on most versions).
 */
export async function updateTask(
  instances: OdooInstanceSettings[],
  { instanceIndex, taskId, stageId, status }: TaskUpdate
): Promise<KanbanTask> {
  const session = await createSessionPool(instances)(instanceIndex)
  const support = await detectTaskFields(session)
  const current = await readOneTask(session, instanceIndex, taskId, support)

  const values: Record<string, unknown> = {}
  if (stageId !== null && stageId !== current.stageId) {
    await requireProjectStage(session, current, stageId)
    values.stage_id = stageId
  }
  if (status !== null) {
    const value =
      support.statusField === null
        ? undefined
        : STATUS_VALUES[support.statusField][status]
    if (support.statusField === null || value === undefined) {
      throw new HttpError(
        `${session.connection.label} doesn't let tasks be set to "${status}".`,
        409
      )
    }
    values[support.statusField] = value
  }
  if (Object.keys(values).length === 0) {
    return current
  }

  await asConflict(
    executeKw(session, "project.task", "write", [[taskId], values])
  )
  return await readOneTask(session, instanceIndex, taskId, support)
}

/* ------------------------------------------------------------------ */
/* POST_TASK_NOTE (test note in the chatter)                           */
/* ------------------------------------------------------------------ */

/**
 * Posts an internal note on the task, as "Log note" does in the chatter,
 * with the user's own Odoo account, then sets the task to approved when
 * asked: the note says why it was approved.
 */
export async function postTaskNote(
  instances: OdooInstanceSettings[],
  { instanceIndex, taskId, note, approve }: TaskNote
): Promise<{ messageId: number; task: KanbanTask }> {
  const session = await createSessionPool(instances)(instanceIndex)
  const support = await detectTaskFields(session)
  // Fails early when the task can't be read, before anything is written.
  await readOneTask(session, instanceIndex, taskId, support)

  const kwargs: Record<string, unknown> = {
    body: noteToHtml(note),
    message_type: "comment",
    subtype_xmlid: "mail.mt_note",
  }
  // From Odoo 17, a string body is escaped unless flagged as HTML.
  const majorVersion = await readServerMajorVersion(session)
  if (majorVersion === null || majorVersion >= 17) {
    kwargs.body_is_html = true
  }
  const posted = await asConflict(
    executeKw(session, "project.task", "message_post", [[taskId]], kwargs)
  )
  // message_post returns the message id, or [id] on some versions.
  const messageId = Array.isArray(posted) ? posted[0] : posted
  if (!isPositiveInteger(messageId)) {
    throw new HttpError("Odoo didn't confirm the note.", 502)
  }

  const task = approve
    ? await updateTask(instances, {
        instanceIndex,
        taskId,
        stageId: null,
        status: "approved",
      })
    : await readOneTask(session, instanceIndex, taskId, support)
  return { messageId, task }
}

/* ------------------------------------------------------------------ */
/* LIST_PROJECTS / LIST_PROJECT_TASKS (manual task picker)             */
/* ------------------------------------------------------------------ */

/** The instance's active projects that accept timesheets, by name. */
export async function listProjects(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex
): Promise<{ projects: OdooProject[]; truncated: boolean }> {
  const session = await createSessionPool(instances)(instanceIndex)
  const available = await getModelFields(session, "project.project")
  // allow_timesheets comes with Timesheets (hr_timesheet): without it, every
  // project is listed and Odoo decides when the line is created.
  const domain = available.has("allow_timesheets")
    ? [["allow_timesheets", "=", true]]
    : []
  const records = await executeKw(
    session,
    "project.project",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        ...(available.has("partner_id") ? ["partner_id"] : []),
      ],
      limit: PROJECT_LIST_LIMIT,
      order: "name asc, id asc",
    }
  )
  const raw = readRecords(records, session, "project")
  return {
    projects: raw.flatMap((record): OdooProject[] => {
      if (
        !isRecord(record) ||
        !isPositiveInteger(record.id) ||
        typeof record.name !== "string"
      ) {
        return []
      }
      return [
        {
          instanceIndex,
          projectId: record.id,
          name: record.name,
          partnerName: readMany2one(record.partner_id)?.name ?? null,
        },
      ]
    }),
    truncated: raw.length >= PROJECT_LIST_LIMIT,
  }
}

/** Active tasks of one project, assigned to anyone, latest first. */
export async function listProjectTasks(
  instances: OdooInstanceSettings[],
  { instanceIndex, projectId, query }: ProjectTaskQuery
): Promise<{ tasks: KanbanTask[]; truncated: boolean }> {
  const session = await createSessionPool(instances)(instanceIndex)
  const support = await detectTaskFields(session)
  const id = readIdQuery(query)
  const matches =
    query === ""
      ? []
      : anyOf([
          ["name", "ilike", query],
          ...(id === null ? [] : [["id", "=", id]]),
        ])
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [[["active", "=", true], ["project_id", "=", projectId], ...matches]],
    {
      fields: support.fields,
      limit: PROJECT_TASKS_LIMIT,
      order: "priority desc, id desc",
    }
  )
  const raw = readRecords(records, session, "task")
  return {
    tasks: raw.flatMap(
      (record) => readKanbanTask(record, instanceIndex, support) ?? []
    ),
    truncated: raw.length >= PROJECT_TASKS_LIMIT,
  }
}

/* ------------------------------------------------------------------ */
/* LIST_TASKS (All tasks page)                                         */
/* ------------------------------------------------------------------ */

/**
 * Open tasks only: not done or cancelled (Odoo 17+ state), and not in a
 * folded stage, which is how older versions mark finished work. Mirrors
 * isClosedTask() in src/utils/kanban.ts.
 */
function openTaskDomain(support: TaskFieldSupport): unknown[] {
  return [
    ...(support.statusField === "state"
      ? [["state", "not in", ["1_done", "1_canceled"]]]
      : []),
    "|",
    ["stage_id", "=", false],
    ["stage_id.fold", "=", false],
  ]
}

/**
 * Any active task with a project, assigned to anyone, narrowed by the
 * query, projects and assignees; with the stages and states the board
 * needs, like GET_MY_TASKS.
 */
export function listTasks(
  instances: OdooInstanceSettings[],
  { query, projects, assignees, includeClosed, instanceIndex }: TaskListQuery
): Promise<MyTasksResult[]> {
  const id = readIdQuery(query)
  const matches =
    query === ""
      ? []
      : anyOf([
          ["name", "ilike", query],
          ["project_id", "ilike", query],
          ...(id === null ? [] : [["id", "=", id]]),
        ])
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTaskFields(session)
      const statuses = statusOptions(support.statusField)
      const filterDomain = filterDomainFor({ projects, assignees }, index, {
        projectField: "project_id",
        assigneeField: support.assigneeField,
      })
      if (filterDomain === null) {
        return {
          tasks: [],
          stages: [],
          statusOptions: statuses,
          truncated: false,
        }
      }
      const records = await executeKw(
        session,
        "project.task",
        "search_read",
        [
          [
            ["active", "=", true],
            ["project_id", "!=", false],
            ...(includeClosed ? [] : openTaskDomain(support)),
            ...filterDomain,
            ...matches,
          ],
        ],
        {
          fields: support.fields,
          limit: TASK_LIST_LIMIT,
          order: "priority desc, id desc",
        }
      )
      const raw = readRecords(records, session, "task")
      const tasks = raw.flatMap(
        (record) => readKanbanTask(record, index, support) ?? []
      )
      return {
        tasks,
        stages: await readStages(session, index, tasks),
        statusOptions: statuses,
        truncated: raw.length >= TASK_LIST_LIMIT,
      }
    }
  )
}

/* ------------------------------------------------------------------ */
/* LIST_ASSIGNEES (assignee filter)                                    */
/* ------------------------------------------------------------------ */

/** The internal users of each instance (portal users get no tasks), by name. */
export function listAssignees(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): Promise<AssigneesInstanceResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const fields = await getModelFields(session, "res.users")
      const records = await executeKw(
        session,
        "res.users",
        "search_read",
        [fields.has("share") ? [["share", "=", false]] : []],
        {
          fields: ["id", "name"],
          limit: ASSIGNEE_LIST_LIMIT,
          order: "name asc, id asc",
        }
      )
      const raw = readRecords(records, session, "user")
      return {
        users: raw.flatMap((record): OdooAssignee[] =>
          isRecord(record) &&
          isPositiveInteger(record.id) &&
          typeof record.name === "string"
            ? [{ instanceIndex: index, userId: record.id, name: record.name }]
            : []
        ),
        currentUserId: session.uid,
        truncated: raw.length >= ASSIGNEE_LIST_LIMIT,
      }
    }
  )
}
