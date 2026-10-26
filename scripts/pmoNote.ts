/** Pure helpers of the PMO command line (scripts/pmoTask.ts). */

export {
  noteToHtml,
  readMajorVersion,
} from "../supabase/functions/_shared/chatterNote.ts"

export type TaskTarget =
  { kind: "id"; id: number } | { kind: "ref"; ref: string }

/** "#1234" is a task id; "03-500" or "[03-500]" is a reference in the task name. */
export function parseTaskTarget(value: string): TaskTarget | null {
  const trimmed = value.trim()
  const id = /^#(\d+)$/.exec(trimmed)
  if (id !== null) {
    const parsed = Number(id[1])
    return parsed > 0 ? { kind: "id", id: parsed } : null
  }
  const ref = trimmed.replace(/^\[(.*)\]$/, "$1").trim()
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(ref) ? { kind: "ref", ref } : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True when the reference is a whole token: "03-500" matches "[03-500]" but not "103-500" or "03-5001". */
export function containsWholeRef(value: unknown, taskRef: string): boolean {
  if (typeof value !== "string") {
    return false
  }
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9-])${escapeRegExp(taskRef)}($|[^A-Za-z0-9-])`,
    "i"
  )
  return pattern.test(value)
}

/** The field and value that mark a task as approved: state from Odoo 17, kanban_state before. */
export function approvedValue(
  fields: ReadonlySet<string>
): { field: "state" | "kanban_state"; value: string } | null {
  if (fields.has("kanban_state")) {
    return { field: "kanban_state", value: "done" }
  }
  if (fields.has("state")) {
    return { field: "state", value: "03_approved" }
  }
  return null
}
