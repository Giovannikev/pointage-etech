import type {
  AssigneesInstanceResult,
  KanbanTask,
  OdooInstanceIndex,
  OdooProject,
} from "@/types/timesheet"
import { normalizeText, type ProjectOption } from "@/utils/kanban"

/** Filter key of the records nobody is assigned to. */
export const UNASSIGNED_KEY = "none"

/** "1:12" (instance:id) or "none", as found in a URL. */
const ASSIGNEE_KEY_PARAM = /^(?:[12]:\d+|none)$/

/** Identifies a user across instances: the same id in two instances is two users. */
export function assigneeKey(
  instanceIndex: OdooInstanceIndex,
  userId: number
): string {
  return `${instanceIndex}:${userId}`
}

/** The valid assignee keys of a comma-separated URL parameter. */
export function parseAssigneeParam(value: string | null): Set<string> {
  return new Set(
    (value ?? "").split(",").filter((key) => ASSIGNEE_KEY_PARAM.test(key))
  )
}

export interface AssigneeOption {
  /** Unique among the options: the normalized name. */
  id: string
  name: string
  /**
   * The user's keys, one per instance: a colleague usually has an account
   * on each instance, under the same name, and is listed once.
   */
  keys: string[]
  /** The signed-in user, listed first. */
  isMe: boolean
}

function inScope(
  instance: "all" | OdooInstanceIndex,
  instanceIndex: OdooInstanceIndex
): boolean {
  return instance === "all" || instance === instanceIndex
}

/**
 * The users of the selected instances, merged by name across instances:
 * the signed-in user first, then everyone by name.
 */
export function listAssigneeOptions(
  results: AssigneesInstanceResult[] | undefined,
  instance: "all" | OdooInstanceIndex
): AssigneeOption[] {
  const options = new Map<string, AssigneeOption>()
  for (const result of results ?? []) {
    if (!result.ok || !inScope(instance, result.instanceIndex)) continue
    for (const user of result.users) {
      const id = normalizeText(user.name)
      const option = options.get(id) ?? {
        id,
        name: user.name,
        keys: [],
        isMe: false,
      }
      options.set(id, {
        ...option,
        keys: [...option.keys, assigneeKey(user.instanceIndex, user.userId)],
        isMe: option.isMe || user.userId === result.currentUserId,
      })
    }
  }
  return [...options.values()].sort((a, b) =>
    a.isMe !== b.isMe ? (a.isMe ? -1 : 1) : a.name.localeCompare(b.name)
  )
}

/** The option is picked when any of its accounts is. */
export function isAssigneeSelected(
  option: Pick<AssigneeOption, "keys">,
  selected: ReadonlySet<string>
): boolean {
  return option.keys.some((key) => selected.has(key))
}

/** Picks or drops every account of the option at once. */
export function toggleAssignee(
  option: Pick<AssigneeOption, "keys">,
  selected: ReadonlySet<string>
): Set<string> {
  const next = new Set(selected)
  const isSelected = isAssigneeSelected(option, selected)
  for (const key of option.keys) {
    if (isSelected) next.delete(key)
    else next.add(key)
  }
  return next
}

/** Names by assignee key, to show who works on a task. */
export function assigneeNamesByKey(
  results: AssigneesInstanceResult[] | undefined
): Map<string, string> {
  const names = new Map<string, string>()
  for (const result of results ?? []) {
    if (!result.ok) continue
    for (const user of result.users) {
      names.set(assigneeKey(user.instanceIndex, user.userId), user.name)
    }
  }
  return names
}

/** The task's assignees by name; users missing from the list are left out. */
export function taskAssigneeNames(
  task: Pick<KanbanTask, "instanceIndex" | "assigneeIds">,
  names: ReadonlyMap<string, string>
): string[] {
  return task.assigneeIds.flatMap(
    (userId) => names.get(assigneeKey(task.instanceIndex, userId)) ?? []
  )
}

/** Every project of the selected instances, by name, for the project filter. */
export function projectOptionsFrom(
  projects: OdooProject[],
  instance: "all" | OdooInstanceIndex
): ProjectOption[] {
  return projects
    .filter((project) => inScope(instance, project.instanceIndex))
    .map((project): ProjectOption => ({
      key: `${project.instanceIndex}:${project.projectId}`,
      name: project.name,
      instanceIndex: project.instanceIndex,
      taskCount: null,
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}
