import {
  cacheKey,
  odooCache,
  type CacheKey,
  type CacheReadOptions,
} from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  GATEWAY_FUNCTION,
  PROJECTS_PREFIX,
  PROJECTS_TTL_MS,
  PROJECT_TASKS_PREFIX,
  SEARCH_TTL_MS,
  invokeGateway,
  isInstanceIndex,
  isNullableString,
  readList,
  searchKey,
} from "@/services/odoo/shared"
import { toKanbanTask } from "@/services/odoo/tasks"
import type {
  ListProjectsResponse,
  ListProjectTasksResponse,
  OdooInstanceIndex,
  OdooProject,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

/* ------------------------------------------------------------------ */
/* LIST_PROJECTS / LIST_PROJECT_TASKS (manual task picker)             */
/* ------------------------------------------------------------------ */

function toOdooProject(value: unknown): OdooProject {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.projectId) &&
    typeof value.name === "string" &&
    isNullableString(value.partnerName)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      projectId: value.projectId,
      name: value.name,
      partnerName: value.partnerName,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function projectsKey(
  instanceIndex: OdooInstanceIndex
): CacheKey<ListProjectsResponse> {
  return cacheKey(`${PROJECTS_PREFIX}${instanceIndex}`)
}

/** The instance's projects that accept timesheets; cached for a few minutes. */
export function fetchProjects(
  instanceIndex: OdooInstanceIndex,
  options: CacheReadOptions = {}
): Promise<ListProjectsResponse> {
  return odooCache.getOrFetch(
    projectsKey(instanceIndex),
    PROJECTS_TTL_MS,
    async () => {
      const data = await invokeGateway({
        action: "LIST_PROJECTS",
        instanceIndex,
      })
      if (!isRecord(data)) {
        throw new InvalidResponseError(GATEWAY_FUNCTION)
      }
      return {
        projects: readList(data.projects, toOdooProject),
        truncated: data.truncated === true,
      }
    },
    options
  )
}

export function peekProjects(
  instanceIndex: OdooInstanceIndex
): ListProjectsResponse | undefined {
  return odooCache.peek(projectsKey(instanceIndex))
}

function projectTasksKey(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string
): CacheKey<ListProjectTasksResponse> {
  return cacheKey(
    searchKey(`${PROJECT_TASKS_PREFIX}${instanceIndex}:${projectId}:`, query)
  )
}

/**
 * Active tasks of a project, assigned to anyone; `query` (optional) narrows
 * them in Odoo when the project has too many. Cached for a minute.
 */
export function fetchProjectTasks(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string,
  options: CacheReadOptions = {}
): Promise<ListProjectTasksResponse> {
  return odooCache.getOrFetch(
    projectTasksKey(instanceIndex, projectId, query),
    SEARCH_TTL_MS,
    async () => {
      const data = await invokeGateway({
        action: "LIST_PROJECT_TASKS",
        instanceIndex,
        projectId,
        query: query.trim(),
      })
      if (!isRecord(data)) {
        throw new InvalidResponseError(GATEWAY_FUNCTION)
      }
      return {
        tasks: readList(data.tasks, toKanbanTask),
        truncated: data.truncated === true,
      }
    },
    options
  )
}

export function peekProjectTasks(
  instanceIndex: OdooInstanceIndex,
  projectId: number,
  query: string
): ListProjectTasksResponse | undefined {
  return odooCache.peek(projectTasksKey(instanceIndex, projectId, query))
}

export interface ProjectsInstanceResult {
  instanceIndex: OdooInstanceIndex
  /** undefined when the instance couldn't be read. */
  projects: OdooProject[] | undefined
}

/**
 * The projects of several instances, each read (and cached) on its own: an
 * instance that fails only leaves its projects out.
 */
export async function fetchProjectsOf(
  instanceIndexes: OdooInstanceIndex[],
  options: CacheReadOptions = {}
): Promise<ProjectsInstanceResult[]> {
  const results = await Promise.allSettled(
    instanceIndexes.map((index) => fetchProjects(index, options))
  )
  return results.map((result, position) => ({
    instanceIndex: instanceIndexes[position],
    projects: result.status === "fulfilled" ? result.value.projects : undefined,
  }))
}

/** The cached projects, when every instance's are fresh. */
export function peekProjectsOf(
  instanceIndexes: OdooInstanceIndex[]
): ProjectsInstanceResult[] | undefined {
  const results: ProjectsInstanceResult[] = []
  for (const instanceIndex of instanceIndexes) {
    const cached = peekProjects(instanceIndex)
    if (cached === undefined) {
      return undefined
    }
    results.push({ instanceIndex, projects: cached.projects })
  }
  return results
}
