import type { InstanceIndex } from "../_shared/settings.ts"
import type { RecordFilters } from "./contract.ts"
import { anyOf } from "./helpers.ts"

/* ------------------------------------------------------------------ */
/* Project and assignee filters (LIST_TASKS, SEARCH_TICKETS)           */
/* ------------------------------------------------------------------ */

export function hasRecordFilters({
  projects,
  assignees,
}: RecordFilters): boolean {
  return projects.length > 0 || assignees.length > 0
}

/** The ids of the keys ("1:12") that belong to the instance. */
function idsOf(keys: string[], instanceIndex: InstanceIndex): number[] {
  const prefix = `${instanceIndex}:`
  return keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
}

/**
 * The Odoo domain of the filters on one instance, or null when they select
 * nothing there (e.g. only projects of the other instance were picked).
 * `projectField` null: the model has no project, so a project filter
 * matches none of its records.
 */
export function filterDomainFor(
  { projects, assignees }: RecordFilters,
  instanceIndex: InstanceIndex,
  fields: {
    projectField: string | null
    assigneeField: string
  }
): unknown[] | null {
  const domain: unknown[] = []

  if (projects.length > 0) {
    const projectIds = idsOf(projects, instanceIndex)
    if (projectIds.length === 0 || fields.projectField === null) {
      return null
    }
    domain.push([fields.projectField, "in", projectIds])
  }

  if (assignees.length > 0) {
    const userIds = idsOf(assignees, instanceIndex)
    const leaves: unknown[] = []
    if (userIds.length > 0) {
      leaves.push([fields.assigneeField, "in", userIds])
    }
    if (assignees.includes("none")) {
      leaves.push([fields.assigneeField, "=", false])
    }
    if (leaves.length === 0) {
      return null
    }
    domain.push(...anyOf(leaves))
  }

  return domain
}
