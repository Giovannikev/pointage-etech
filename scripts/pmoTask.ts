/**
 * PMO command line: posts a test note on an Odoo task and sets it to
 * Approved, with the user's own Odoo account. Meant to be run by Claude at
 * the end of a test session, or by hand.
 *
 * Usage:
 *   node scripts/pmoTask.ts show <task>
 *   node scripts/pmoTask.ts note <task> [--file note.txt]
 *   node scripts/pmoTask.ts approve <task> [--file note.txt] [--dry-run]
 *
 * <task> is a reference found in the task name ("03-500", "[03-500]") or a
 * task id ("#1234"). The note is read from --file, or from stdin when piped.
 * It is posted as an internal note ("Enregistrer une note" in the chatter),
 * before the state is changed.
 *
 * Configuration (environment variables, can live in .env):
 *   PMO_URL      Odoo address, e.g. https://pmo.example.com
 *   PMO_DB       Database (optional when the server hosts a single one)
 *   PMO_LOGIN    Odoo login
 *   PMO_API_KEY  Odoo API key (Preferences → Account Security → New API Key)
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  approvedValue,
  containsWholeRef,
  noteToHtml,
  parseTaskTarget,
  readMajorVersion,
  type TaskTarget,
} from "./pmoNote.ts"

const RPC_TIMEOUT_MS = 20_000
const TASK_CANDIDATE_LIMIT = 20

interface Connection {
  url: string
  db: string
  login: string
  apiKey: string
}

interface Session extends Connection {
  uid: number
  majorVersion: number | null
}

interface Task {
  id: number
  name: string
  project: string | null
  stage: string | null
  state: string | null
}

class CliError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

let rpcRequestId = 0

async function postJsonRpc(
  url: string,
  params: Record<string, unknown>
): Promise<unknown> {
  rpcRequestId += 1
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params,
      id: rpcRequestId,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  }).catch((error: unknown) => {
    // fetch only says "fetch failed": the network reason is in its cause.
    const reason =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : String(error)
    throw new CliError(`${url} is unreachable (${reason}).`)
  })
  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get("Location") ?? "another address"
    throw new CliError(`${url} redirects to ${target}. Fix PMO_URL.`)
  }
  if (!response.ok) {
    throw new CliError(`${url} responded with HTTP ${response.status}.`)
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!isRecord(payload)) {
    throw new CliError(`${url} returned an invalid JSON-RPC payload.`)
  }
  if (isRecord(payload.error)) {
    const { data, message } = payload.error
    const detail =
      isRecord(data) && typeof data.message === "string" ? data.message : null
    throw new CliError(
      `Odoo error: ${detail ?? (typeof message === "string" ? message : "unknown")}`
    )
  }
  return payload.result
}

function callService(
  url: string,
  service: "common" | "object",
  method: string,
  args: unknown[]
): Promise<unknown> {
  return postJsonRpc(`${url}/jsonrpc`, { service, method, args })
}

function executeKw(
  session: Session,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  return callService(session.url, "object", "execute_kw", [
    session.db,
    session.uid,
    session.apiKey,
    model,
    method,
    args,
    kwargs,
  ])
}

function loadEnvFile(): void {
  const path = resolve(import.meta.dirname, "../.env")
  if (existsSync(path)) {
    process.loadEnvFile(path)
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new CliError(`${name} is missing: set it in .env (see .env.example).`)
  }
  return value
}

async function detectDatabase(url: string): Promise<string> {
  const databases = await postJsonRpc(`${url}/web/database/list`, {}).catch(
    () => null
  )
  if (
    Array.isArray(databases) &&
    databases.length === 1 &&
    typeof databases[0] === "string"
  ) {
    return databases[0]
  }
  throw new CliError("Couldn't detect the PMO database: set PMO_DB in .env.")
}

async function openSession(): Promise<Session> {
  const url = requireEnv("PMO_URL").replace(/\/+$/, "")
  const login = requireEnv("PMO_LOGIN")
  const apiKey = requireEnv("PMO_API_KEY")
  const db = process.env.PMO_DB?.trim() || (await detectDatabase(url))

  const uid = await callService(url, "common", "authenticate", [
    db,
    login,
    apiKey,
    {},
  ])
  if (typeof uid !== "number" || uid <= 0) {
    throw new CliError(
      "Authentication failed on the PMO. Check PMO_DB, PMO_LOGIN and PMO_API_KEY."
    )
  }
  const version = await callService(url, "common", "version", [])
  const majorVersion = isRecord(version)
    ? readMajorVersion(version.server_version_info)
    : null
  return { url, db, login, apiKey, uid, majorVersion }
}

async function getTaskFields(session: Session): Promise<Set<string>> {
  const fields = await executeKw(session, "project.task", "fields_get", [], {
    attributes: ["type"],
  })
  return new Set(isRecord(fields) ? Object.keys(fields) : [])
}

function readName(value: unknown): string | null {
  return Array.isArray(value) && typeof value[1] === "string" ? value[1] : null
}

async function readTasks(
  session: Session,
  domain: unknown[],
  statusField: string | null
): Promise<Task[]> {
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "project_id",
        "stage_id",
        ...(statusField === null ? [] : [statusField]),
      ],
      limit: TASK_CANDIDATE_LIMIT,
      order: "id desc",
    }
  )
  return (Array.isArray(records) ? records : []).flatMap((record): Task[] =>
    isRecord(record) &&
    typeof record.id === "number" &&
    typeof record.name === "string"
      ? [
          {
            id: record.id,
            name: record.name,
            project: readName(record.project_id),
            stage: readName(record.stage_id),
            state:
              statusField !== null && typeof record[statusField] === "string"
                ? record[statusField]
                : null,
          },
        ]
      : []
  )
}

async function findTask(
  session: Session,
  target: TaskTarget,
  statusField: string | null
): Promise<Task> {
  if (target.kind === "id") {
    const [task] = await readTasks(
      session,
      [["id", "=", target.id]],
      statusField
    )
    if (task === undefined) {
      throw new CliError(`Task #${target.id} doesn't exist or isn't readable.`)
    }
    return task
  }
  const candidates = await readTasks(
    session,
    [["name", "ilike", target.ref]],
    statusField
  )
  const matches = candidates.filter((task) =>
    containsWholeRef(task.name, target.ref)
  )
  if (matches.length === 0) {
    throw new CliError(`No task named with "${target.ref}" on the PMO.`)
  }
  if (matches.length > 1) {
    const list = matches.map((task) => `  #${task.id} ${task.name}`).join("\n")
    throw new CliError(
      `Several tasks match "${target.ref}", pass the id instead:\n${list}`
    )
  }
  return matches[0]
}

function taskUrl(session: Session, task: Task): string {
  return `${session.url}/web#id=${task.id}&model=project.task&view_type=form`
}

function describe(session: Session, task: Task): string {
  return [
    `#${task.id} ${task.name}`,
    `  Project: ${task.project ?? "-"}`,
    `  Stage:   ${task.stage ?? "-"}`,
    `  State:   ${task.state ?? "-"}`,
    `  Link:    ${taskUrl(session, task)}`,
  ].join("\n")
}

async function readNote(file: string | undefined): Promise<string | null> {
  if (file !== undefined) {
    return readFileSync(file, "utf8")
  }
  if (process.stdin.isTTY) {
    return null
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Posts an internal note, as "Enregistrer une note" does in the chatter. */
async function postNote(
  session: Session,
  task: Task,
  note: string
): Promise<number> {
  const kwargs: Record<string, unknown> = {
    body: noteToHtml(note),
    message_type: "comment",
    subtype_xmlid: "mail.mt_note",
  }
  // From Odoo 17, a string body is escaped unless flagged as HTML.
  if (session.majorVersion === null || session.majorVersion >= 17) {
    kwargs.body_is_html = true
  }
  const messageId = await executeKw(
    session,
    "project.task",
    "message_post",
    [[task.id]],
    kwargs
  )
  return typeof messageId === "number"
    ? messageId
    : Array.isArray(messageId) && typeof messageId[0] === "number"
      ? messageId[0]
      : 0
}

const USAGE = `Usage:
  node scripts/pmoTask.ts show <task>
  node scripts/pmoTask.ts note <task> [--file note.txt]
  node scripts/pmoTask.ts approve <task> [--file note.txt] [--dry-run]

<task>: a reference in the task name ("03-500") or an id ("#1234").`

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string", short: "f" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  const [command, rawTarget] = positionals
  if (values.help || command === undefined) {
    console.log(USAGE)
    return
  }
  if (
    !["show", "note", "approve"].includes(command) ||
    rawTarget === undefined
  ) {
    throw new CliError(USAGE)
  }
  const target = parseTaskTarget(rawTarget)
  if (target === null) {
    throw new CliError(
      `"${rawTarget}" is neither a task reference nor "#<id>".`
    )
  }

  const note = command === "show" ? null : await readNote(values.file)
  if (command === "note" && (note === null || note.trim() === "")) {
    throw new CliError("The note is empty: pass --file or pipe it on stdin.")
  }

  loadEnvFile()
  const session = await openSession()
  const approved = approvedValue(await getTaskFields(session))
  const task = await findTask(session, target, approved?.field ?? null)
  console.log(describe(session, task))

  if (command === "show") {
    return
  }
  if (command === "approve" && approved === null) {
    throw new CliError("This PMO has no task state field to approve tasks.")
  }
  if (values["dry-run"]) {
    if (note !== null && note.trim() !== "") {
      console.log(`\nDry run, note not posted:\n${note.trim()}`)
    }
    if (approved !== null && command === "approve") {
      console.log(`\nDry run, ${approved.field} not set to ${approved.value}.`)
    }
    return
  }

  if (note !== null && note.trim() !== "") {
    const messageId = await postNote(session, task, note)
    console.log(`\nNote posted (message ${messageId}).`)
  }
  if (command === "approve" && approved !== null) {
    if (task.state === approved.value) {
      console.log("Task already approved.")
      return
    }
    await executeKw(session, "project.task", "write", [
      [task.id],
      { [approved.field]: approved.value },
    ])
    const updated = await findTask(
      session,
      { kind: "id", id: task.id },
      approved.field
    )
    if (updated.state !== approved.value) {
      throw new CliError(
        `Odoo kept the task in state "${updated.state ?? "-"}" instead of "${approved.value}".`
      )
    }
    console.log(`Task set to approved (${approved.field} = ${approved.value}).`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
