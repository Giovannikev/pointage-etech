import type {
  HelpdeskTicket,
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  MyTasksInstanceResult,
  OdooInstanceIndex,
  TicketsInstanceResult,
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

/** "18486" or "#18486": a record id, as Odoo is searched by id too. */
const ID_QUERY = /^#?(\d{1,9})$/

/**
 * Every word of the query must appear in the task name or its project; a
 * query such as "#18486" also matches the task with that id.
 */
export function matchesTaskSearch(task: KanbanTask, query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const id = ID_QUERY.exec(query.trim())
  if (id !== null && Number(id[1]) === task.taskId) {
    return true
  }
  const haystack = normalizeText(`${task.name} ${task.projectName ?? ""}`)
  return words.every((word) => haystack.includes(word))
}

/** Every word of the query must appear in the ticket's title, reference, id, team or project. */
export function matchesTicketSearch(
  ticket: HelpdeskTicket,
  query: string
): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const haystack = normalizeText(
    [
      ticket.name,
      ticket.ref ?? "",
      String(ticket.ticketId),
      ticket.teamName ?? "",
      ticket.projectName ?? "",
    ].join(" ")
  )
  return words.every((word) => haystack.includes(word))
}

/** A card of the board: one of the user's tasks, or one of their helpdesk tickets. */
export type BoardCard =
  | { kind: "task"; task: KanbanTask }
  | { kind: "ticket"; ticket: HelpdeskTicket }

/** Unique across kinds and instances, for React keys. */
export function cardKey(card: BoardCard): string {
  return card.kind === "task"
    ? `task:${card.task.instanceIndex}:${card.task.taskId}`
    : `ticket:${card.ticket.instanceIndex}:${card.ticket.ticketId}`
}

function cardItem(card: BoardCard): KanbanTask | HelpdeskTicket {
  return card.kind === "task" ? card.task : card.ticket
}

/** Hours already logged on the card, when known. */
function cardHours(card: BoardCard): number | null {
  return card.kind === "task"
    ? card.task.effectiveHours
    : card.ticket.hoursSpent
}

/** The user's open tickets of the selected instances. */
export function listTickets(
  results: TicketsInstanceResult[] | undefined,
  instance: "all" | OdooInstanceIndex
): HelpdeskTicket[] {
  return (results ?? []).flatMap((result) =>
    result.ok && (instance === "all" || result.instanceIndex === instance)
      ? result.tickets
      : []
  )
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
  cards: BoardCard[]
  /** Hours already logged on the column's tasks and tickets, when known. */
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
export function projectKey(
  item: Pick<KanbanTask | HelpdeskTicket, "instanceIndex" | "projectId">
): string {
  return item.projectId === null
    ? NO_PROJECT_KEY
    : `${item.instanceIndex}:${item.projectId}`
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
  /** Tasks and tickets of the project on the board; null when unknown. */
  taskCount: number | null
}

function compareNames(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a.localeCompare(b)
}

/** The projects of the tasks (and tickets) in scope, by name. */
export function listProjects(
  results: MyTasksInstanceResult[],
  scope: BoardScope,
  tickets: HelpdeskTicket[] = []
): ProjectOption[] {
  const options = new Map<string, ProjectOption>()
  const items: (KanbanTask | HelpdeskTicket)[] = [
    ...scopeTasks(results, scope).tasks,
    ...scopeTickets(tickets, scope.instance),
  ]
  for (const item of items) {
    const key = projectKey(item)
    const option = options.get(key) ?? {
      key,
      name: item.projectName,
      instanceIndex: item.projectId === null ? null : item.instanceIndex,
      taskCount: 0,
    }
    options.set(key, { ...option, taskCount: (option.taskCount ?? 0) + 1 })
  }
  return [...options.values()].sort((a, b) => compareNames(a.name, b.name))
}

/** Tickets have no deadline. */
function cardDeadline(card: BoardCard): string | null {
  return card.kind === "task" && card.task.deadline !== null
    ? toLocalIsoDate(card.task.deadline)
    : null
}

/** Starred first, then by nearest deadline, then by name. */
function compareCards(a: BoardCard, b: BoardCard): number {
  const itemA = cardItem(a)
  const itemB = cardItem(b)
  if (itemA.priority !== itemB.priority) {
    return itemB.priority - itemA.priority
  }
  const deadlineA = cardDeadline(a)
  const deadlineB = cardDeadline(b)
  if (deadlineA !== deadlineB) {
    if (deadlineA === null) return 1
    if (deadlineB === null) return -1
    return deadlineA.localeCompare(deadlineB)
  }
  return itemA.name.localeCompare(itemB.name)
}

/** Tickets are only read while open, so none of them is closed. */
function scopeTickets(
  tickets: HelpdeskTicket[],
  instance: "all" | OdooInstanceIndex
): HelpdeskTicket[] {
  return tickets.filter(
    (ticket) => instance === "all" || ticket.instanceIndex === instance
  )
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
function placeCard(
  card: BoardCard,
  stage: KanbanStage | undefined,
  groupBy: BoardGrouping
): ColumnPlacement {
  const item = cardItem(card)
  if (groupBy === "project") {
    return {
      key: projectKey(item),
      name: item.projectName,
      instanceIndex: item.projectId === null ? null : item.instanceIndex,
      sequence: 0,
      folded: false,
    }
  }
  // A ticket's helpdesk stage joins the task column of the same name, if
  // any; otherwise it gets a column of its own after the task stages.
  const name = stage?.name ?? item.stageName
  return {
    key: name === null ? NO_STAGE_KEY : normalizeText(name),
    name,
    instanceIndex: null,
    sequence: stage?.sequence ?? Number.POSITIVE_INFINITY,
    folded: stage?.folded ?? false,
  }
}

/**
 * Groups the tasks, and the open tickets when given, into columns named
 * after the Odoo stages and ordered by their sequence. Only columns holding
 * cards are returned, plus the empty stages of the picked projects.
 */
export function buildBoard(
  results: MyTasksInstanceResult[],
  { query, projects, groupBy, ...scope }: BoardFilters,
  tickets: HelpdeskTicket[] = []
): BoardColumn[] {
  const { tasks, stages } = scopeTasks(results, scope)
  const cards: BoardCard[] = [
    ...tasks.map((task): BoardCard => ({ kind: "task", task })),
    ...scopeTickets(tickets, scope.instance).map((ticket): BoardCard => ({
      kind: "ticket",
      ticket,
    })),
  ]

  // Built locally, then returned as fresh objects: nothing shared is mutated.
  const columns = new Map<string, BoardColumn>()
  for (const card of cards) {
    if (projects.size > 0 && !projects.has(projectKey(cardItem(card)))) continue
    const matches =
      card.kind === "task"
        ? matchesTaskSearch(card.task, query)
        : matchesTicketSearch(card.ticket, query)
    if (!matches) continue

    const stage = card.kind === "task" ? stageOf(card.task, stages) : undefined
    const placement = placeCard(card, stage, groupBy)
    let column = columns.get(placement.key)
    if (column === undefined) {
      column = {
        key: placement.key,
        kind: groupBy,
        name: placement.name,
        instanceIndex: placement.instanceIndex,
        sequence: placement.sequence,
        folded: true,
        cards: [],
        effectiveHours: 0,
      }
      columns.set(placement.key, column)
    }
    column.sequence = Math.min(column.sequence, placement.sequence)
    // A stage column is folded only if every merged stage is folded in Odoo.
    column.folded = column.folded && placement.folded
    column.cards.push(card)
    column.effectiveHours += cardHours(card) ?? 0
  }

  // With projects picked, their empty stages show too, as in Odoo, so the
  // columns follow the projects' own pipeline. Not while searching, and
  // folded stages only with closed tasks shown: their tasks are hidden.
  if (groupBy === "stage" && projects.size > 0 && query.trim() === "") {
    for (const stage of stages.values()) {
      if (stage.folded && !scope.showClosed) continue
      const isUsed = stage.projectIds.some((projectId) =>
        projects.has(
          projectKey({ instanceIndex: stage.instanceIndex, projectId })
        )
      )
      if (!isUsed) continue
      const key = normalizeText(stage.name)
      const column = columns.get(key)
      if (column === undefined) {
        columns.set(key, {
          key,
          kind: "stage",
          name: stage.name,
          instanceIndex: null,
          sequence: stage.sequence,
          folded: stage.folded,
          cards: [],
          effectiveHours: 0,
        })
      } else {
        column.sequence = Math.min(column.sequence, stage.sequence)
      }
    }
  }

  return [...columns.values()]
    .map((column) => ({
      ...column,
      cards: column.cards.sort(compareCards),
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

/* ---- Editing from the board ---------------------------------------- */

/** Unique across instances. */
export function taskKey(
  task: Pick<KanbanTask, "instanceIndex" | "taskId">
): string {
  return `${task.instanceIndex}:${task.taskId}`
}

function compareStages(a: KanbanStage, b: KanbanStage): number {
  return a.sequence - b.sequence || a.stageId - b.stageId
}

/**
 * The stages the task can move to: those of its project, in its instance,
 * in Odoo's order, without the one it is in. Empty for a task without a
 * project, or when the gateway doesn't send the stages' projects.
 */
export function listMoveTargets(
  results: MyTasksInstanceResult[],
  task: KanbanTask
): KanbanStage[] {
  const { projectId } = task
  if (projectId === null) {
    return []
  }
  const result = results.find(
    (candidate) => candidate.instanceIndex === task.instanceIndex
  )
  if (result === undefined || !result.ok) {
    return []
  }
  return result.stages
    .filter(
      (stage) =>
        stage.stageId !== task.stageId && stage.projectIds.includes(projectId)
    )
    .sort(compareStages)
}

/**
 * The stage of the task's project behind a stage column. Columns merge the
 * stages of every project by name, so the column "Test interne" is a
 * different stage record in each project. null when the project has no
 * stage of that name: the task can't be dropped there.
 */
export function findColumnStage(
  results: MyTasksInstanceResult[],
  task: KanbanTask,
  columnKey: string
): KanbanStage | null {
  return (
    listMoveTargets(results, task).find(
      (stage) => normalizeText(stage.name) === columnKey
    ) ?? null
  )
}

/** The states a task of the instance can be set to. */
export function statusOptionsOf(
  results: MyTasksInstanceResult[] | undefined,
  instanceIndex: OdooInstanceIndex
): KanbanTaskStatus[] {
  const result = results?.find(
    (candidate) => candidate.instanceIndex === instanceIndex
  )
  return result !== undefined && result.ok ? result.statusOptions : []
}

/** The results with this task replaced (matched by instance and id). */
export function replaceTask(
  results: MyTasksInstanceResult[],
  task: KanbanTask
): MyTasksInstanceResult[] {
  const key = taskKey(task)
  return results.map((result) =>
    result.ok && result.instanceIndex === task.instanceIndex
      ? {
          ...result,
          tasks: result.tasks.map((candidate) =>
            taskKey(candidate) === key ? task : candidate
          ),
        }
      : result
  )
}

/** The task as it will look in the stage, before Odoo answers. */
export function moveToStage(task: KanbanTask, stage: KanbanStage): KanbanTask {
  return { ...task, stageId: stage.stageId, stageName: stage.name }
}
