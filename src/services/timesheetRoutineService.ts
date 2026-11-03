import { detectTimezone } from "@/services/autoAttendanceService"
import { getSupabaseClient } from "@/services/supabaseClient"
import type { OdooInstanceIndex } from "@/types/timesheet"
import { isRecord } from "@/utils/guards"

/**
 * Timesheet routines: a line logged in Odoo every working day at a set time
 * (a break, organizing the day's work), by the auto-attendance Edge
 * Function. Read and written straight from the browser: RLS limits each
 * user to their own rows
 * (supabase/migrations/20261103000000_timesheet_routines.sql).
 */

const TABLE = "timesheet_routines"
const COLUMNS =
  "id, enabled, instance_index, project_id, task_id, task_name, project_name, description, hours, log_at, last_logged_on"

/** The routines' default time of the day. */
export const DEFAULT_ROUTINE_TIME = "17:00"

export interface TimesheetRoutine {
  id: string
  enabled: boolean
  instanceIndex: OdooInstanceIndex
  projectId: number
  taskId: number
  taskName: string
  projectName: string | null
  description: string
  hours: number
  /** Local "HH:MM". */
  logAt: string
  /** The last day handled, YYYY-MM-DD. */
  lastLoggedOn: string | null
}

export type NewTimesheetRoutine = Omit<
  TimesheetRoutine,
  "id" | "enabled" | "lastLoggedOn"
>

export type RoutineChanges = Partial<
  Pick<TimesheetRoutine, "enabled" | "description" | "hours" | "logAt">
>

function readRoutine(row: unknown): TimesheetRoutine | null {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.enabled !== "boolean" ||
    (row.instance_index !== 1 && row.instance_index !== 2) ||
    typeof row.project_id !== "number" ||
    typeof row.task_id !== "number" ||
    typeof row.task_name !== "string" ||
    typeof row.description !== "string" ||
    typeof row.log_at !== "string"
  ) {
    return null
  }
  return {
    id: row.id,
    enabled: row.enabled,
    instanceIndex: row.instance_index,
    projectId: row.project_id,
    taskId: row.task_id,
    taskName: row.task_name,
    projectName: typeof row.project_name === "string" ? row.project_name : null,
    description: row.description,
    // numeric columns come back as numbers or strings.
    hours: Number(row.hours),
    logAt: row.log_at.slice(0, 5),
    lastLoggedOn:
      typeof row.last_logged_on === "string" ? row.last_logged_on : null,
  }
}

function toColumns(changes: RoutineChanges): Record<string, unknown> {
  return {
    ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
    ...(changes.description === undefined
      ? {}
      : { description: changes.description }),
    ...(changes.hours === undefined ? {} : { hours: changes.hours }),
    ...(changes.logAt === undefined ? {} : { log_at: changes.logAt }),
  }
}

export async function fetchRoutines(): Promise<TimesheetRoutine[]> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select(COLUMNS)
    .order("log_at")
    .order("created_at")
  if (error !== null) {
    throw new Error(error.message)
  }
  return (data ?? []).flatMap((row: unknown) => readRoutine(row) ?? [])
}

export async function createRoutine(
  routine: NewTimesheetRoutine
): Promise<void> {
  const { error } = await getSupabaseClient().from(TABLE).insert({
    instance_index: routine.instanceIndex,
    project_id: routine.projectId,
    task_id: routine.taskId,
    task_name: routine.taskName,
    project_name: routine.projectName,
    description: routine.description,
    hours: routine.hours,
    log_at: routine.logAt,
    timezone: detectTimezone(),
  })
  if (error !== null) {
    throw new Error(error.message)
  }
}

export async function updateRoutine(
  id: string,
  changes: RoutineChanges
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(TABLE)
    // The time zone follows the browser the routine was last saved from.
    .update({ ...toColumns(changes), timezone: detectTimezone() })
    .eq("id", id)
  if (error !== null) {
    throw new Error(error.message)
  }
}

export async function deleteRoutine(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from(TABLE).delete().eq("id", id)
  if (error !== null) {
    throw new Error(error.message)
  }
}

const listeners = new Set<() => void>()

/** Calls `listener` after each change of the routines; returns the unsubscribe. */
export function onRoutinesChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyRoutinesChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
