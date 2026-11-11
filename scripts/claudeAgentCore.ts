/**
 * Pure parts of the Claude agent (scripts/claudeAgent.ts): its configuration,
 * which folder a job runs in, and the `claude` command line it runs.
 */
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

/** A job older than this is not started: the user has moved on. */
export const JOB_TTL_MS = 10 * 60_000

export const PERMISSION_MODES = [
  "acceptEdits",
  "auto",
  "default",
  "dontAsk",
  "plan",
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export interface AgentConfig {
  /** Permission mode of the sessions; never bypassPermissions. */
  permissionMode: PermissionMode
  /** Each session works in its own git worktree, leaving the checkout alone. */
  worktree: boolean
  /** Local folder of each project: by project name, or "<instance>:<project id>". */
  projects: Record<string, string>
  /** Folder of the projects not listed; null refuses them. */
  defaultFolder: string | null
}

export const DEFAULT_CONFIG: AgentConfig = {
  permissionMode: "acceptEdits",
  worktree: true,
  projects: {},
  defaultFolder: null,
}

/** The job as the agent reads it from claude_jobs. */
export interface ClaudeJob {
  id: string
  instance_index: number
  task_id: number
  task_name: string
  project_id: number | null
  project_name: string | null
  prompt: string
  status: string
  created_at: string
}

export class ConfigError extends Error {}

/** Reads the configuration file's JSON, filling in what it leaves out. */
export function parseConfig(value: unknown): AgentConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError("The configuration must be a JSON object.")
  }
  const raw = value as Record<string, unknown>
  const config: AgentConfig = { ...DEFAULT_CONFIG, projects: {} }

  if (raw.permissionMode !== undefined) {
    if (!PERMISSION_MODES.includes(raw.permissionMode as PermissionMode)) {
      throw new ConfigError(
        `permissionMode must be one of ${PERMISSION_MODES.join(", ")}.`
      )
    }
    config.permissionMode = raw.permissionMode as PermissionMode
  }
  if (raw.worktree !== undefined) {
    if (typeof raw.worktree !== "boolean") {
      throw new ConfigError("worktree must be true or false.")
    }
    config.worktree = raw.worktree
  }
  if (raw.projects !== undefined) {
    if (typeof raw.projects !== "object" || raw.projects === null) {
      throw new ConfigError(
        'projects must map names to folders: {"Name": "~/repo"}.'
      )
    }
    for (const [key, folder] of Object.entries(raw.projects)) {
      if (typeof folder !== "string") {
        throw new ConfigError(
          `The folder of project "${key}" must be a string.`
        )
      }
      if (folder.trim() !== "") config.projects[key] = folder.trim()
    }
  }
  if (raw.defaultFolder !== undefined && raw.defaultFolder !== null) {
    if (typeof raw.defaultFolder !== "string") {
      throw new ConfigError("defaultFolder must be a string or null.")
    }
    config.defaultFolder = raw.defaultFolder.trim() || null
  }
  return config
}

/** "~/x" and "~" are under the home folder; other paths must be absolute. */
export function expandHome(path: string, home: string = homedir()): string {
  if (path === "~") return home
  if (path.startsWith("~/")) return join(home, path.slice(2))
  return path
}

export type FolderResult =
  { ok: true; folder: string } | { ok: false; error: string }

/** Where the job's session works: its project's folder, or the default one. */
export function resolveJobFolder(
  config: AgentConfig,
  job: ClaudeJob,
  home: string = homedir()
): FolderResult {
  const byId =
    job.project_id === null
      ? undefined
      : config.projects[`${job.instance_index}:${job.project_id}`]
  const name = job.project_name?.trim().toLowerCase()
  const byName =
    name === undefined
      ? undefined
      : Object.entries(config.projects).find(
          ([key]) => key.trim().toLowerCase() === name
        )?.[1]
  const folder = byId ?? byName ?? config.defaultFolder
  if (folder === null || folder === undefined) {
    const key = job.project_name ?? `${job.instance_index}:${job.project_id}`
    return {
      ok: false,
      error: `No folder for project "${key}" on this computer: add it under "projects" in the agent's configuration.`,
    }
  }
  const expanded = expandHome(folder, home)
  if (!isAbsolute(expanded)) {
    return {
      ok: false,
      error: `The folder "${folder}" must be an absolute path or start with ~/.`,
    }
  }
  return { ok: true, folder: expanded }
}

export function isJobExpired(job: ClaudeJob, now: number): boolean {
  const created = Date.parse(job.created_at)
  return Number.isNaN(created) || now - created > JOB_TTL_MS
}

/** "[03-500] Title" → "03-500"; null without a reference. */
function taskRef(taskName: string): string | null {
  return /^\s*\[([^\]]+)\]/.exec(taskName)?.[1]?.trim() ?? null
}

/** Name shown in Claude (app, claude.ai/code, `claude agents`). */
export function sessionName(job: ClaudeJob): string {
  const name = `Pointage · ${job.task_name.trim()}`
  return name.length <= 80 ? name : `${name.slice(0, 79).trimEnd()}…`
}

/** A git-safe worktree name: "pointage-03-500-1a2b3c". */
export function worktreeName(job: ClaudeJob): string {
  const ref = (taskRef(job.task_name) ?? String(job.task_id))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `pointage-${ref || job.task_id}-${job.id.replace(/-/g, "").slice(0, 6)}`
}

/** Arguments of `claude`: a background session, followed through Remote Control. */
export function claudeArgs(config: AgentConfig, job: ClaudeJob): string[] {
  const name = sessionName(job)
  return [
    "--bg",
    "--remote-control",
    name,
    "--name",
    name,
    "--permission-mode",
    config.permissionMode,
    ...(config.worktree ? ["--worktree", worktreeName(job)] : []),
    // The prompt is never read as an option, even when it starts with "-".
    "--",
    job.prompt,
  ]
}

/** Removes the terminal colors and cursor moves of the CLI's output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
}

/** The id `claude --bg` prints: "backgrounded · afcf92e9 · name". */
export function readBackgroundId(output: string): string | null {
  return (
    /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(stripAnsi(output))?.[1] ?? null
  )
}
