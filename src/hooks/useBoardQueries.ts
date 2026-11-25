import { useMemo } from "react"

import { useCachedQuery, type CachedQueryResult } from "@/hooks/useCachedQuery"
import {
  fetchAssignees,
  fetchMyTasks,
  fetchProjectsOf,
  fetchTaskList,
  peekAssignees,
  peekMyTasks,
  peekProjectsOf,
  peekTaskList,
  peekTickets,
  searchTickets,
  type ProjectsInstanceResult,
  type TaskListFilters,
} from "@/services/odooService"
import type {
  AssigneesInstanceResult,
  MyTasksInstanceResult,
  OdooInstanceIndex,
  RecordFilters,
  TicketsInstanceResult,
} from "@/types/timesheet"

/** What a board query reads: its key, and how to fetch or peek it. */
interface QuerySource<T> {
  key: string
  fetch: (options: { force: boolean }) => Promise<T>
  peek: () => T | undefined
}

/** A query the board's scope doesn't use: reads nothing, answers at once. */
function idleSource<T>(key: string, value: T): QuerySource<T> {
  return { key, fetch: () => Promise.resolve(value), peek: () => value }
}

/** The source must be memoized: its fetcher identity triggers a load. */
function useSourceQuery<T>(source: QuerySource<T>): CachedQueryResult<T> {
  return useCachedQuery(source.key, source.fetch, source.peek)
}

const MY_TASKS_QUERY_KEY = "myTasks"
/** Same key as the cached read of the user's open tickets. */
const MY_TICKETS_QUERY_KEY = "tickets:mine:"

/*
 * Each board calls every query hook, so their number never changes; the
 * ones its scope doesn't use read nothing and answer at once.
 */
const IDLE_TASKS: MyTasksInstanceResult[] = []
const IDLE_TICKETS: TicketsInstanceResult[] = []
const IDLE_PROJECTS: ProjectsInstanceResult[] = []
const IDLE_ASSIGNEES: AssigneesInstanceResult[] = []

interface BoardQueryOptions {
  /** All tasks (true) or My tasks (false). */
  isAll: boolean
  /** All tasks reads nothing until something narrows the tasks down. */
  isIdle: boolean
  /** The search sent to Odoo (All tasks). */
  serverQuery: string
  recordFilters: RecordFilters
  listFilters: TaskListFilters
  instanceIndexes: OdooInstanceIndex[]
}

export interface BoardQueries {
  tasksQuery: CachedQueryResult<MyTasksInstanceResult[]>
  ticketsQuery: CachedQueryResult<TicketsInstanceResult[]>
  /** The filter's projects (All tasks). */
  projectsQuery: CachedQueryResult<ProjectsInstanceResult[]>
  /** The filter's assignees (All tasks). */
  assigneesQuery: CachedQueryResult<AssigneesInstanceResult[]>
}

/** The cached Odoo reads behind a task board. */
export function useBoardQueries({
  isAll,
  isIdle,
  serverQuery,
  recordFilters,
  listFilters,
  instanceIndexes,
}: BoardQueryOptions): BoardQueries {
  const tasksSource = useMemo((): QuerySource<MyTasksInstanceResult[]> => {
    if (!isAll) {
      return { key: MY_TASKS_QUERY_KEY, fetch: fetchMyTasks, peek: peekMyTasks }
    }
    if (isIdle) return idleSource("taskList:idle", IDLE_TASKS)
    return {
      key: `taskList:${JSON.stringify(listFilters)}`,
      fetch: (options) => fetchTaskList(listFilters, options),
      peek: () => peekTaskList(listFilters),
    }
  }, [isAll, isIdle, listFilters])

  // My tasks: the user's open tickets. All tasks: the open tickets the
  // filters select, read whether shown or not, to know if there are any.
  const ticketsSource = useMemo((): QuerySource<TicketsInstanceResult[]> => {
    if (!isAll) {
      return {
        key: MY_TICKETS_QUERY_KEY,
        fetch: (options) => searchTickets("", true, options),
        peek: () => peekTickets("", true),
      }
    }
    if (isIdle) return idleSource("tickets:idle", IDLE_TICKETS)
    return {
      key: `tickets:filtered:${serverQuery}:${JSON.stringify(recordFilters)}`,
      fetch: (options) =>
        searchTickets(serverQuery, false, options, recordFilters),
      peek: () => peekTickets(serverQuery, false, recordFilters),
    }
  }, [isAll, isIdle, serverQuery, recordFilters])

  const projectsSource = useMemo(
    (): QuerySource<ProjectsInstanceResult[]> =>
      isAll
        ? {
            key: `projectsOf:${instanceIndexes.join(",")}`,
            fetch: (options) => fetchProjectsOf(instanceIndexes, options),
            peek: () => peekProjectsOf(instanceIndexes),
          }
        : idleSource("projectsOf:idle", IDLE_PROJECTS),
    [isAll, instanceIndexes]
  )

  const assigneesSource = useMemo(
    (): QuerySource<AssigneesInstanceResult[]> =>
      isAll
        ? { key: "assignees", fetch: fetchAssignees, peek: peekAssignees }
        : idleSource("assignees:idle", IDLE_ASSIGNEES),
    [isAll]
  )

  return {
    tasksQuery: useSourceQuery(tasksSource),
    ticketsQuery: useSourceQuery(ticketsSource),
    projectsQuery: useSourceQuery(projectsSource),
    assigneesQuery: useSourceQuery(assigneesSource),
  }
}
