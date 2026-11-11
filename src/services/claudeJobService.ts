import { getSupabaseClient } from "@/services/supabaseClient"
import type { KanbanTask } from "@/types/timesheet"
import { isRecord } from "@/utils/guards"

/**
 * "Do with Claude" from a phone: a job recorded here is started on the
 * user's computer by the Claude agent (scripts/claudeAgent.ts), which reads
 * the same tables as the user. RLS limits both to the user's own rows
 * (supabase/migrations/20261111000000_claude_jobs.sql).
 */

const JOBS_TABLE = "claude_jobs"
const AGENTS_TABLE = "claude_agents"

export type ClaudeJobStatus = "pending" | "launching" | "started" | "failed"

export interface ClaudeJob {
  id: string
  status: ClaudeJobStatus
  /** The computer that took the job. */
  agentHost: string | null
  sessionName: string | null
  error: string | null
  createdAt: string
}

export interface ClaudeAgent {
  host: string
  lastSeenAt: string
}

const JOB_STATUSES: readonly string[] = [
  "pending",
  "launching",
  "started",
  "failed",
]

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function toJob(row: unknown): ClaudeJob {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.status !== "string" ||
    !JOB_STATUSES.includes(row.status) ||
    typeof row.created_at !== "string"
  ) {
    throw new Error("The Claude job is unreadable.")
  }
  return {
    id: row.id,
    status: row.status as ClaudeJobStatus,
    agentHost: nullableString(row.agent_host),
    sessionName: nullableString(row.session_name),
    error: nullableString(row.error),
    createdAt: row.created_at,
  }
}

const JOB_COLUMNS = "id, status, agent_host, session_name, error, created_at"

/** Asks the agent of the user's computer to start a session on the task. */
export async function createClaudeJob(
  task: KanbanTask,
  prompt: string
): Promise<ClaudeJob> {
  const { data, error } = await getSupabaseClient()
    .from(JOBS_TABLE)
    .insert({
      instance_index: task.instanceIndex,
      task_id: task.taskId,
      task_name: task.name,
      project_id: task.projectId,
      project_name: task.projectName,
      prompt,
    })
    .select(JOB_COLUMNS)
    .single()
  if (error !== null) {
    throw new Error(error.message)
  }
  return toJob(data)
}

export async function fetchClaudeJob(id: string): Promise<ClaudeJob> {
  const { data, error } = await getSupabaseClient()
    .from(JOBS_TABLE)
    .select(JOB_COLUMNS)
    .eq("id", id)
    .single()
  if (error !== null) {
    throw new Error(error.message)
  }
  return toJob(data)
}

/** The user's agent and when it last said it was online; null: never set up. */
export async function fetchClaudeAgent(): Promise<ClaudeAgent | null> {
  const { data, error } = await getSupabaseClient()
    .from(AGENTS_TABLE)
    .select("host, last_seen_at")
    .maybeSingle()
  if (error !== null) {
    throw new Error(error.message)
  }
  const row: unknown = data
  if (
    !isRecord(row) ||
    typeof row.host !== "string" ||
    typeof row.last_seen_at !== "string"
  ) {
    return null
  }
  return { host: row.host, lastSeenAt: row.last_seen_at }
}
