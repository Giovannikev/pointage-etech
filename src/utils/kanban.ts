import type {
  KanbanStage,
  KanbanTask,
  MyTasksInstanceResult,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { toLocalIsoDate } from "@/utils/date"
import { roundHours } from "@/utils/timesheetRules"

/** Column key of the tasks that have no stage. */
export const NO_STAGE_KEY = "__no_stage__"

const BRACKET_REF = /^\s*\[([^\]]{1,64})\]\s*(.*)$/s

export interface TaskNameParts {
  /** "01-501" for "[01-501] Export to Excel", null without a bracketed reference. */
  ref: string | null
  title: string
}

export function splitTaskName(name: string): TaskNameParts {
  const match = BRACKET_REF.exec(name)
  if (match === null) {
    return { ref: null, title: name.trim() }
  }
  const title = match[2].trim()
  return { ref: match[1].trim(), title: title === "" ? name.trim() : title }
}

/** Lower case without accents, so "Équipe" matches "equipe". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim()
}

/** Every word of the query must appear in the task name or its project. */
export function matchesTaskSearch(task: KanbanTask, query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const haystack = normalizeText(`${task.name} ${task.projectName ?? ""}`)
  return words.every((word) => haystack.includes(word))
}

export type BoardGrouping = "stage" | "project"

export interface BoardColumn {
  key: string
  kind: BoardGrouping
  /** null for the tasks without a stage (or without a project). */
  name: string | null
  /** Set for project columns: the instance the project lives in. */
  instanceIndex: OdooInstanceIndex | null
  sequence: number
  /** Folded in Odoo (usually done or cancelled stages). */
  folded: boolean
  tasks: KanbanTask[]
  /** Hours already logged on the column's tasks, when known. */
  effectiveHours: number
}

/** Which tasks are on the board before the search and project filters. */
export interface BoardScope {
  instance: "all" | OdooInstanceIndex
  /** Shows done and cancelled tasks, and tasks in folded stages. */
  showClosed: boolean
}

export interface BoardFilters extends BoardScope {
  query: string
  /** Keys from projectKey(); empty means every project. */
  projects: ReadonlySet<string>
  groupBy: BoardGrouping
}

/** Key of the tasks that have no project. */
export const NO_PROJECT_KEY = "none"

/**
 * Identifies a project across instances: the same id in two instances is two
 * different projects.
 */
export function projectKey(task: KanbanTask): string {
  return task.projectId === null
    ? NO_PROJECT_KEY
    : `${task.instanceIndex}:${task.projectId}`
}

function stageKey(instanceIndex: OdooInstanceIndex, stageId: number): string {
  return `${instanceIndex}:${stageId}`
}

interface ScopedTasks {
  tasks: KanbanTask[]
  stages: Map<string, KanbanStage>
}

function stageOf(
  task: KanbanTask,
  stages: Map<string, KanbanStage>
): KanbanStage | undefined {
  return task.stageId === null
    ? undefined
    : stages.get(stageKey(task.instanceIndex, task.stageId))
}

/**
 * Closed: done or cancelled (Odoo 17+ state), or sitting in a folded stage,
 * which is how older versions mark finished work.
 */
export function isClosedTask(
  task: KanbanTask,
  stage: KanbanStage | undefined
): boolean {
  return (
    task.status === "done" ||
    task.status === "canceled" ||
    stage?.folded === true
  )
}

/** The tasks of the selected instances, without closed ones unless asked. */
function scopeTasks(
  results: MyTasksInstanceResult[],
  { instance, showClosed }: BoardScope
): ScopedTasks {
  const stages = new Map<string, KanbanStage>()
  const tasks: KanbanTask[] = []
  for (const result of results) {
    if (!result.ok) continue
    if (instance !== "all" && result.instanceIndex !== instance) continue
    for (const stage of result.stages) {
      stages.set(stageKey(stage.instanceIndex, stage.stageId), stage)
    }
    tasks.push(...result.tasks)
  }
  return {
    stages,
    tasks: showClosed
      ? tasks
      : tasks.filter((task) => !isClosedTask(task, stageOf(task, stages))),
  }
}

/** How many tasks of the scope are closed, to tell the user they're hidden. */
export function countClosedTasks(
  results: MyTasksInstanceResult[],
  instance: "all" | OdooInstanceIndex
): number {
  const { tasks, stages } = scopeTasks(results, { instance, showClosed: true })
  return tasks.filter((task) => isClosedTask(task, stageOf(task, stages)))
    .length
}

export interface ProjectOption {
  key: string
  /** null for the tasks without a project. */
  name: string | null
  /** null when the option gathers tasks of several instances (no project). */
  instanceIndex: OdooInstanceIndex | null
  taskCount: number
}

function compareNames(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a.localeCompare(b)
}

/** The projects of the tasks in scope, by name. */
export function listProjects(
  results: MyTasksInstanceResult[],
  scope: BoardScope
): ProjectOption[] {
  const options = new Map<string, ProjectOption>()
  for (const task of scopeTasks(results, scope).tasks) {
    const key = projectKey(task)
    const option = options.get(key) ?? {
      key,
      name: task.projectName,
      instanceIndex: task.projectId === null ? null : task.instanceIndex,
      taskCount: 0,
    }
    options.set(key, { ...option, taskCount: option.taskCount + 1 })
  }
  return [...options.values()].sort((a, b) => compareNames(a.name, b.name))
}

/** Starred first, then by nearest deadline, then by name. */
function compareTasks(a: KanbanTask, b: KanbanTask): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority
  }
  const deadlineA = a.deadline === null ? null : toLocalIsoDate(a.deadline)
  const deadlineB = b.deadline === null ? null : toLocalIsoDate(b.deadline)
  if (deadlineA !== deadlineB) {
    if (deadlineA === null) return 1
    if (deadlineB === null) return -1
    return deadlineA.localeCompare(deadlineB)
  }
  return a.name.localeCompare(b.name)
}

function compareColumns(a: BoardColumn, b: BoardColumn): number {
  if (a.name === null) return 1
  if (b.name === null) return -1
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence
  }
  return a.name.localeCompare(b.name)
}

interface ColumnPlacement {
  key: string
  name: string | null
  instanceIndex: OdooInstanceIndex | null
  sequence: number
  folded: boolean
}

/**
 * By stage, stages are merged by name: projects (and instances) usually have
 * their own stage records with the same names ("In progress" in every
 * project), so there is one column per stage name, placed by its lowest
 * sequence. By project, there is one column per project, by name.
 */
function placeTask(
  task: KanbanTask,
  stage: KanbanStage | undefined,
  groupBy: BoardGrouping
): ColumnPlacement {
  if (groupBy === "project") {
    return {
      key: projectKey(task),
      name: task.projectName,
      instanceIndex: task.projectId === null ? null : task.instanceIndex,
      sequence: 0,
      folded: false,
    }
  }
  const name = stage?.name ?? task.stageName
  return {
    key: name === null ? NO_STAGE_KEY : normalizeText(name),
    name,
    instanceIndex: null,
    sequence: stage?.sequence ?? Number.POSITIVE_INFINITY,
    folded: stage?.folded ?? false,
  }
}

/** Groups the tasks into columns. Only columns holding tasks are returned. */
export function buildBoard(
  results: MyTasksInstanceResult[],
  { query, projects, groupBy, ...scope }: BoardFilters
): BoardColumn[] {
  const { tasks, stages } = scopeTasks(results, scope)

  // Built locally, then returned as fresh objects: nothing shared is mutated.
  const columns = new Map<string, BoardColumn>()
  for (const task of tasks) {
    if (projects.size > 0 && !projects.has(projectKey(task))) continue
    if (!matchesTaskSearch(task, query)) continue

    const placement = placeTask(task, stageOf(task, stages), groupBy)
    let column = columns.get(placement.key)
    if (column === undefined) {
      column = {
        key: placement.key,
        kind: groupBy,
        name: placement.name,
        instanceIndex: placement.instanceIndex,
        sequence: placement.sequence,
        folded: true,
        tasks: [],
        effectiveHours: 0,
      }
      columns.set(placement.key, column)
    }
    column.sequence = Math.min(column.sequence, placement.sequence)
    // A stage column is folded only if every merged stage is folded in Odoo.
    column.folded = column.folded && placement.folded
    column.tasks.push(task)
    column.effectiveHours += task.effectiveHours ?? 0
  }

  return [...columns.values()]
    .map((column) => ({
      ...column,
      tasks: column.tasks.sort(compareTasks),
      effectiveHours: roundHours(column.effectiveHours),
    }))
    .sort(compareColumns)
}

/** Share of the planned hours already logged, capped at 1; null without a plan. */
export function hoursProgress(task: KanbanTask): number | null {
  if (task.plannedHours === null || task.effectiveHours === null) {
    return null
  }
  return Math.min(1, task.effectiveHours / task.plannedHours)
}
