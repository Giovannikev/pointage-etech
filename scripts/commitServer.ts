/**
 * Local commit server for Pointage.
 *
 * Reads today's commits from local Git repositories and serves them at
 * GET /api/today-commits as { commits: [{ hash, message, date, repository }] }.
 *
 * Configuration (environment variables, can live in .env):
 *   GIT_REPOS            Comma-separated absolute paths of the repositories
 *   GIT_AUTHOR_EMAIL     Author to keep (optional, defaults to each
 *                        repository's `git config user.email`)
 *   COMMIT_SERVER_PORT   Port (optional, defaults to 3001)
 *   COMMIT_SERVER_ORIGIN Allowed CORS origin (optional, defaults to
 *                        http://localhost:5173, the Vite dev server)
 */
import { execFile } from "node:child_process"
import { createServer, type ServerResponse } from "node:http"
import { basename } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const ROUTE = "/api/today-commits"
const GIT_TIMEOUT_MS = 10_000
const FIELD_SEPARATOR = "\u001f"
const RECORD_SEPARATOR = "\u001e"

interface ServedCommit {
  hash: string
  message: string
  /** Author date, YYYY-MM-DD. */
  date: string
  /** Full ISO author timestamp, used to order the day. */
  authoredAt: string
  repository: string
}

function readList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

const repositories = readList(process.env.GIT_REPOS)
const configuredAuthor = process.env.GIT_AUTHOR_EMAIL?.trim() || null
const port = Number(process.env.COMMIT_SERVER_PORT ?? 3001)
const allowedOrigin =
  process.env.COMMIT_SERVER_ORIGIN?.trim() || "http://localhost:5173"

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}

/** Local date as YYYY-MM-DD. */
function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

async function resolveAuthor(repository: string): Promise<string | null> {
  if (configuredAuthor !== null) {
    return configuredAuthor
  }
  try {
    return (await git(repository, ["config", "user.email"])).trim() || null
  } catch {
    return null
  }
}

async function readTodayCommits(
  repository: string,
  today: string
): Promise<ServedCommit[]> {
  const author = await resolveAuthor(repository)
  const output = await git(repository, [
    "log",
    "--branches",
    "--no-merges",
    `--since=${today} 00:00`,
    ...(author === null ? [] : [`--author=${author}`]),
    `--pretty=format:%H${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${RECORD_SEPARATOR}`,
  ])

  return (
    output
      .split(RECORD_SEPARATOR)
      .map((record) => record.trim().split(FIELD_SEPARATOR))
      .filter((fields) => fields.length === 3)
      .map(([hash, authorDate, message]) => ({
        hash,
        message,
        date: authorDate.slice(0, 10),
        authoredAt: authorDate,
        repository: basename(repository),
      }))
      // --since filters on the committer date; keep work authored today only.
      .filter((commit) => commit.date === today)
  )
}

async function collectCommits(): Promise<ServedCommit[]> {
  const today = localIsoDate(new Date())
  const settled = await Promise.allSettled(
    repositories.map((repository) => readTodayCommits(repository, today))
  )

  const seen = new Set<string>()
  const commits: ServedCommit[] = []
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const reason =
        result.reason instanceof Error ? result.reason.message : result.reason
      console.warn(`Skipped ${repositories[index]}: ${String(reason)}`)
      return
    }
    for (const commit of result.value) {
      if (!seen.has(commit.hash)) {
        seen.add(commit.hash)
        commits.push(commit)
      }
    }
  })

  if (
    repositories.length > 0 &&
    settled.every((r) => r.status === "rejected")
  ) {
    throw new Error("None of the configured repositories could be read.")
  }
  // Oldest first, so the timesheet follows the order of the day.
  return commits.sort(
    (a, b) => Date.parse(a.authoredAt) - Date.parse(b.authoredAt)
  )
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
    })
    response.end()
    return
  }
  if (request.method !== "GET" || path !== ROUTE) {
    sendJson(response, 404, { error: `Use GET ${ROUTE}.` })
    return
  }

  collectCommits()
    .then((commits) => sendJson(response, 200, { commits }))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, { error: message })
    })
})

if (repositories.length === 0) {
  console.error("Set GIT_REPOS to a comma-separated list of repository paths.")
  process.exit(1)
}

// Bound to loopback only: commits never leave this machine.
server.listen(port, "127.0.0.1", () => {
  console.log(`Commit server on http://localhost:${port}${ROUTE}`)
  for (const repository of repositories) {
    console.log(`  watching ${repository}`)
  }
})
