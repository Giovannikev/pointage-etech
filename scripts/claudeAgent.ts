/**
 * Claude agent for Pointage: starts on this computer the Claude Code
 * sessions asked for from the phone ("Do with Claude").
 *
 * Pointage records each request in the claude_jobs table. This agent, signed
 * in as you, hears them through Realtime (and polls every minute), finds the
 * project's local folder in its configuration, and runs
 *   claude --bg --remote-control <name> --worktree <name> -- <prompt>
 * in it. The session runs here; follow and answer it from the Claude app or
 * claude.ai/code. Every minute the agent tells Pointage it is online.
 *
 * Usage:
 *   node scripts/claudeAgent.ts login    sign in once (the password isn't kept)
 *   node scripts/claudeAgent.ts          run (or: run)
 *   node scripts/claudeAgent.ts logout   forget the session
 *
 * Files, in ~/.config/pointage/claude-agent/ (or $POINTAGE_AGENT_DIR):
 *   config.json   permission mode, worktrees, and the folder of each project
 *   session.json  the Supabase session (refresh token), readable by you only
 *
 * Environment (.env): VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, as for
 * the app; CLAUDE_BIN when `claude` isn't on the PATH.
 */
import { execFile } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  DEFAULT_CONFIG,
  ConfigError,
  claudeArgs,
  isJobExpired,
  parseConfig,
  readBackgroundId,
  resolveJobFolder,
  sessionName,
  stripAnsi,
  type AgentConfig,
  type ClaudeJob,
} from "./claudeAgentCore.ts"

const HEARTBEAT_MS = 60_000
const LAUNCH_TIMEOUT_MS = 90_000
const JOBS_TABLE = "claude_jobs"
const AGENTS_TABLE = "claude_agents"

const AGENT_DIR =
  process.env.POINTAGE_AGENT_DIR ??
  join(
    process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? ".", ".config"),
    "pointage",
    "claude-agent"
  )
const CONFIG_PATH = join(AGENT_DIR, "config.json")
const SESSION_PATH = join(AGENT_DIR, "session.json")

class CliError extends Error {}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

function loadEnvFile(): void {
  const path = resolve(import.meta.dirname, "../.env")
  if (existsSync(path)) process.loadEnvFile(path)
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value)
    throw new CliError(`${name} is missing: set it in .env (see .env.example).`)
  return value
}

/* ---- Files -------------------------------------------------------- */

function ensureAgentDir(): void {
  mkdirSync(AGENT_DIR, { recursive: true, mode: 0o700 })
}

function readConfig(): AgentConfig {
  if (!existsSync(CONFIG_PATH)) {
    ensureAgentDir()
    writeFileSync(
      CONFIG_PATH,
      `${JSON.stringify({ ...DEFAULT_CONFIG, projects: { "Project name in Odoo": "~/path/to/repository" } }, null, 2)}\n`
    )
    log(`Created ${CONFIG_PATH}: set the folder of each project there.`)
  }
  try {
    return parseConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliError(`${CONFIG_PATH}: ${reason}`)
  }
}

/** Supabase keeps its session in session.json, readable by the user only. */
const fileStorage = {
  getItem(key: string): string | null {
    if (!existsSync(SESSION_PATH)) return null
    const stored = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as Record<
      string,
      string
    >
    return stored[key] ?? null
  },
  setItem(key: string, value: string): void {
    ensureAgentDir()
    const stored = existsSync(SESSION_PATH)
      ? (JSON.parse(readFileSync(SESSION_PATH, "utf8")) as Record<
          string,
          string
        >)
      : {}
    stored[key] = value
    writeFileSync(SESSION_PATH, JSON.stringify(stored), { mode: 0o600 })
    chmodSync(SESSION_PATH, 0o600)
  },
  removeItem(key: string): void {
    if (!existsSync(SESSION_PATH)) return
    const stored = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as Record<
      string,
      string
    >
    delete stored[key]
    writeFileSync(SESSION_PATH, JSON.stringify(stored), { mode: 0o600 })
  },
}

function createSupabase(): SupabaseClient {
  return createClient(
    requireEnv("VITE_SUPABASE_URL"),
    requireEnv("VITE_SUPABASE_ANON_KEY"),
    {
      auth: {
        storage: fileStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }
  )
}

/* ---- login / logout ------------------------------------------------- */

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  if (hidden) {
    // Echo nothing while the password is typed.
    const output = rl as unknown as { _writeToOutput: (text: string) => void }
    output._writeToOutput = (text: string) => {
      if (text.includes(question)) process.stdout.write(question)
    }
  }
  return new Promise((done) => {
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write("\n")
      done(answer.trim())
    })
  })
}

async function login(): Promise<void> {
  const supabase = createSupabase()
  const email = await ask("Pointage email: ")
  const password = await ask("Password: ", true)
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error !== null) throw new CliError(`Sign-in refused: ${error.message}`)
  log(
    `Signed in as ${data.user.email}. Session kept in ${SESSION_PATH}; the password is not.`
  )
  readConfig()
}

function logout(): void {
  rmSync(SESSION_PATH, { force: true })
  log("Session forgotten.")
}

/* ---- run ------------------------------------------------------------ */

function runClaude(args: string[], cwd: string): Promise<string> {
  const bin = process.env.CLAUDE_BIN?.trim() || "claude"
  return new Promise((done, fail) => {
    execFile(
      bin,
      args,
      { cwd, timeout: LAUNCH_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        if (error !== null) {
          const detail = stripAnsi(output)
            .trim()
            .split("\n")
            .slice(-3)
            .join(" ")
          fail(new Error(detail || error.message))
        } else {
          done(output)
        }
      }
    )
  })
}

class Agent {
  private readonly supabase: SupabaseClient
  private readonly host = hostname()
  private userId = ""
  /** Jobs are started one after the other. */
  private queue: Promise<void> = Promise.resolve()
  private readonly seen = new Set<string>()

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async start(): Promise<void> {
    const { data, error } = await this.supabase.auth.getUser()
    if (error !== null || data.user === null) {
      throw new CliError(
        "Not signed in: run `node scripts/claudeAgent.ts login` first."
      )
    }
    this.userId = data.user.id
    readConfig()
    log(
      `Claude agent of ${data.user.email} on ${this.host}. Configuration: ${CONFIG_PATH}`
    )

    await this.heartbeat()
    setInterval(() => void this.heartbeat(), HEARTBEAT_MS)

    this.supabase
      .channel("claude-jobs")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: JOBS_TABLE,
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => this.enqueue(payload.new as ClaudeJob)
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") log("Listening for jobs.")
        else if (status !== "CLOSED")
          log(`Realtime: ${status} (jobs are still polled every minute).`)
      })
  }

  /** Says the agent is online, and picks up jobs Realtime may have missed. */
  private async heartbeat(): Promise<void> {
    const { error } = await this.supabase
      .from(AGENTS_TABLE)
      .upsert({
        user_id: this.userId,
        host: this.host,
        last_seen_at: new Date().toISOString(),
      })
    if (error !== null) log(`Heartbeat failed: ${error.message}`)

    const { data, error: readError } = await this.supabase
      .from(JOBS_TABLE)
      .select("*")
      .eq("status", "pending")
      .order("created_at")
    if (readError !== null) {
      log(`Reading the jobs failed: ${readError.message}`)
      return
    }
    for (const job of data as ClaudeJob[]) this.enqueue(job)
  }

  private enqueue(job: ClaudeJob): void {
    if (job.status !== "pending" || this.seen.has(job.id)) return
    this.seen.add(job.id)
    this.queue = this.queue
      .then(() => this.handle(job))
      .catch((error: unknown) => {
        log(
          `Job ${job.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }

  private async update(
    job: ClaudeJob,
    fields: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.supabase
      .from(JOBS_TABLE)
      .update({
        ...fields,
        agent_host: this.host,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
    if (error !== null)
      log(`Job ${job.id}: saving its state failed: ${error.message}`)
  }

  private async handle(job: ClaudeJob): Promise<void> {
    // Takes the job, unless it is no longer waiting.
    const { data: claimed, error } = await this.supabase
      .from(JOBS_TABLE)
      .update({
        status: "launching",
        agent_host: this.host,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
    if (error !== null) throw new Error(`claiming failed: ${error.message}`)
    if (claimed.length === 0) return

    log(`Job ${job.id}: ${job.task_name}`)
    if (isJobExpired(job, Date.now())) {
      await this.update(job, {
        status: "failed",
        error: "Expired: the computer did not pick it up in time.",
      })
      return
    }

    let config: AgentConfig
    try {
      config = readConfig()
    } catch (configError) {
      await this.update(job, {
        status: "failed",
        error: (configError as Error).message,
      })
      return
    }
    const folder = resolveJobFolder(config, job)
    if (!folder.ok) {
      log(`Job ${job.id}: ${folder.error}`)
      await this.update(job, { status: "failed", error: folder.error })
      return
    }
    if (!existsSync(folder.folder) || !statSync(folder.folder).isDirectory()) {
      const message = `The folder ${folder.folder} does not exist on ${this.host}.`
      await this.update(job, { status: "failed", error: message })
      return
    }

    try {
      const output = await runClaude(claudeArgs(config, job), folder.folder)
      const backgroundId = readBackgroundId(output)
      if (backgroundId === null) {
        throw new Error(
          stripAnsi(output).trim().split("\n").slice(-3).join(" ") ||
            "claude printed no session id."
        )
      }
      await this.update(job, {
        status: "started",
        session_name: sessionName(job),
        background_id: backgroundId,
      })
      log(`Job ${job.id}: started ${backgroundId} in ${folder.folder}`)
    } catch (launchError) {
      const message = (
        launchError instanceof Error ? launchError.message : String(launchError)
      ).slice(0, 2000)
      log(`Job ${job.id}: failed: ${message}`)
      await this.update(job, { status: "failed", error: message })
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile()
  const command = process.argv[2] ?? "run"
  if (command === "login") {
    await login()
    // The Supabase client refreshes its token on a timer: stop here.
    process.exit(0)
  }
  if (command === "logout") return logout()
  if (command !== "run")
    throw new CliError(`Unknown command "${command}": login, run or logout.`)
  await new Agent(createSupabase()).start()
}

main().catch((error: unknown) => {
  console.error(
    error instanceof CliError || error instanceof ConfigError
      ? error.message
      : error
  )
  process.exit(1)
})
