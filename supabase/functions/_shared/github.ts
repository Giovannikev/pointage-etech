/**
 * GitHub client. Commits are read through GraphQL: one query lists a
 * repository's branches with the date of their last commit, then the
 * history of the branches active in the period is fetched 20 at a time.
 */
import { HttpError } from "./errors.ts"
import { isIsoTimestamp, isNonEmptyString, isRecord } from "./validation.ts"

const API_URL = "https://api.github.com"
const REQUEST_TIMEOUT_MS = 20_000
const REPOSITORY_CONCURRENCY = 4
const BRANCHES_PER_QUERY = 20
const PAGE_SIZE = 100

export interface GithubViewer {
  login: string
  nodeId: string
}

/** Contract item — mirrors src/types/timesheet.ts. */
export interface GithubCommit {
  message: string
  authoredAt: string
}

export interface CommitQuery {
  since: Date
  until: Date
  authorNodeId: string
  authorEmails: string[]
}

interface Repository {
  owner: string
  name: string
  fullName: string
}

/** GraphQL `CommitAuthor` input: a GitHub user id or a list of emails. */
type CommitAuthor = { id: string } | { emails: string[] }

interface HistoryNode {
  oid: string
  message: string
  authoredDate: string
  isMerge: boolean
}

interface HistoryPage {
  nodes: HistoryNode[]
  nextCursor: string | null
}

const HISTORY_FRAGMENT = `
  fragment History on CommitHistoryConnection {
    pageInfo { hasNextPage endCursor }
    nodes { oid message authoredDate parents { totalCount } }
  }`

const BRANCH_LIST_QUERY = `
  query ($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { name target { ... on Commit { committedDate } } }
      }
    }
  }`

const BRANCH_HISTORY_QUERY = `
  query ($owner: String!, $name: String!, $ref: String!, $since: GitTimestamp!,
         $until: GitTimestamp!, $author: CommitAuthor!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit {
            history(first: ${PAGE_SIZE}, after: $cursor, since: $since,
                    until: $until, author: $author) { ...History }
          }
        }
      }
    }
  }
  ${HISTORY_FRAGMENT}`

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

async function githubFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new HttpError(`GitHub is unreachable (${reason}).`, 502)
  }

  if (response.status === 401) {
    throw new HttpError(
      "GitHub rejected your token. Update it in Settings.",
      400
    )
  }
  if (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const reset = new Date(
      Number(response.headers.get("x-ratelimit-reset")) * 1000
    )
    throw new HttpError(
      `GitHub rate limit reached. Try again after ${reset.toISOString().slice(11, 16)} UTC.`,
      429
    )
  }
  if (!response.ok) {
    throw new HttpError(`GitHub responded with HTTP ${response.status}.`, 502)
  }
  return response
}

function readNextLink(linkHeader: string | null): string | null {
  const next = linkHeader
    ?.split(",")
    .find((part) => part.includes('rel="next"'))
  const match = next?.match(/<([^>]+)>/)
  return match ? match[1].replace(API_URL, "") : null
}

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await githubFetch(token, "/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  const payload: unknown = await response.json()
  if (!isRecord(payload)) {
    throw new HttpError("GitHub returned an invalid GraphQL response.", 502)
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const [first] = payload.errors
    const message =
      isRecord(first) && typeof first.message === "string"
        ? first.message
        : "unknown error"
    throw new HttpError(`GitHub error: ${message}`, 502)
  }
  if (!isRecord(payload.data)) {
    throw new HttpError("GitHub returned an invalid GraphQL response.", 502)
  }
  return payload.data
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await worker(items[index])
      }
    }
  )
  await Promise.all(runners)
  return results
}

/* ------------------------------------------------------------------ */
/* Response readers                                                    */
/* ------------------------------------------------------------------ */

function readHistoryPage(value: unknown): HistoryPage | null {
  if (
    !isRecord(value) ||
    !isRecord(value.pageInfo) ||
    !Array.isArray(value.nodes)
  ) {
    return null
  }
  const nodes = value.nodes.flatMap((node): HistoryNode[] => {
    if (
      !isRecord(node) ||
      typeof node.oid !== "string" ||
      typeof node.message !== "string" ||
      !isIsoTimestamp(node.authoredDate) ||
      !isRecord(node.parents) ||
      typeof node.parents.totalCount !== "number"
    ) {
      return []
    }
    return [
      {
        oid: node.oid,
        message: node.message,
        authoredDate: node.authoredDate,
        isMerge: node.parents.totalCount > 1,
      },
    ]
  })
  const { hasNextPage, endCursor } = value.pageInfo
  return {
    nodes,
    nextCursor:
      hasNextPage === true && typeof endCursor === "string" ? endCursor : null,
  }
}

/** History of a ref target, or null when the ref is gone or not a commit. */
function readRefHistory(ref: unknown, alias: string): HistoryPage | null {
  return isRecord(ref) && isRecord(ref.target)
    ? readHistoryPage(ref.target[alias])
    : null
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function fetchViewer(token: string): Promise<GithubViewer> {
  const response = await githubFetch(token, "/user")
  const user: unknown = await response.json()
  if (
    !isRecord(user) ||
    !isNonEmptyString(user.login, 255) ||
    !isNonEmptyString(user.node_id, 255)
  ) {
    throw new HttpError("GitHub returned an invalid user profile.", 502)
  }
  return { login: user.login, nodeId: user.node_id }
}

/** Repositories the user can access and that received a push since the date. */
async function listActiveRepositories(
  token: string,
  since: Date
): Promise<Repository[]> {
  const repositories: Repository[] = []
  let path: string | null =
    `/user/repos?per_page=${PAGE_SIZE}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`

  while (path !== null) {
    const response = await githubFetch(token, path)
    const page: unknown = await response.json()
    if (!Array.isArray(page)) {
      throw new HttpError("GitHub returned an invalid repository list.", 502)
    }

    let reachedOlder = false
    for (const repo of page) {
      if (
        !isRecord(repo) ||
        typeof repo.name !== "string" ||
        typeof repo.full_name !== "string" ||
        !isRecord(repo.owner) ||
        typeof repo.owner.login !== "string"
      ) {
        continue
      }
      if (isIsoTimestamp(repo.pushed_at) && new Date(repo.pushed_at) >= since) {
        repositories.push({
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
        })
      } else {
        reachedOlder = true
      }
    }
    // Sorted by last push: once an older repository shows up, stop paging.
    path = reachedOlder ? null : readNextLink(response.headers.get("Link"))
  }
  return repositories
}

/** Branches whose last commit is recent enough to hold commits of the period. */
async function listActiveBranches(
  token: string,
  repository: Repository,
  since: Date
): Promise<string[]> {
  const branches: string[] = []
  let cursor: string | null = null

  do {
    const data = await graphql(token, BRANCH_LIST_QUERY, {
      owner: repository.owner,
      name: repository.name,
      cursor,
    })
    const refs = isRecord(data.repository) ? data.repository.refs : null
    if (
      !isRecord(refs) ||
      !Array.isArray(refs.nodes) ||
      !isRecord(refs.pageInfo)
    ) {
      return branches
    }
    for (const ref of refs.nodes) {
      const tipDate =
        isRecord(ref) && isRecord(ref.target) ? ref.target.committedDate : null
      if (
        isRecord(ref) &&
        typeof ref.name === "string" &&
        isIsoTimestamp(tipDate) &&
        new Date(tipDate) >= since
      ) {
        branches.push(ref.name)
      }
    }
    const { hasNextPage, endCursor } = refs.pageInfo
    cursor =
      hasNextPage === true && typeof endCursor === "string" ? endCursor : null
  } while (cursor !== null)

  return branches
}

/** One query reading several branches at once, through aliased refs. */
function buildBatchHistoryQuery(
  branchCount: number,
  authorCount: number
): string {
  const range = (count: number) => Array.from({ length: count }, (_, i) => i)
  const variables = [
    "$owner: String!",
    "$name: String!",
    "$since: GitTimestamp!",
    "$until: GitTimestamp!",
    ...range(authorCount).map((i) => `$author${i}: CommitAuthor!`),
    ...range(branchCount).map((i) => `$ref${i}: String!`),
  ]
  const histories = range(authorCount)
    .map(
      (i) =>
        `a${i}: history(first: ${PAGE_SIZE}, since: $since, until: $until, author: $author${i}) { ...History }`
    )
    .join("\n")
  const refs = range(branchCount)
    .map(
      (i) =>
        `b${i}: ref(qualifiedName: $ref${i}) { target { ... on Commit { ${histories} } } }`
    )
    .join("\n")

  return `query (${variables.join(", ")}) {
    repository(owner: $owner, name: $name) { ${refs} }
  }
  ${HISTORY_FRAGMENT}`
}

/** Follows the pagination of one branch history, used past 100 commits. */
async function fetchRemainingHistory(
  token: string,
  repository: Repository,
  branch: string,
  author: CommitAuthor,
  query: CommitQuery,
  firstCursor: string
): Promise<HistoryNode[]> {
  const nodes: HistoryNode[] = []
  let cursor: string | null = firstCursor

  while (cursor !== null) {
    const data = await graphql(token, BRANCH_HISTORY_QUERY, {
      owner: repository.owner,
      name: repository.name,
      ref: `refs/heads/${branch}`,
      since: query.since.toISOString(),
      until: query.until.toISOString(),
      author,
      cursor,
    })
    const ref = isRecord(data.repository) ? data.repository.ref : null
    const page = readRefHistory(ref, "history")
    if (page === null) {
      break
    }
    nodes.push(...page.nodes)
    cursor = page.nextCursor
  }
  return nodes
}

async function fetchRepositoryCommits(
  token: string,
  repository: Repository,
  query: CommitQuery
): Promise<HistoryNode[]> {
  const branches = await listActiveBranches(token, repository, query.since)
  const authors: CommitAuthor[] = [
    { id: query.authorNodeId },
    ...(query.authorEmails.length > 0 ? [{ emails: query.authorEmails }] : []),
  ]
  const nodes: HistoryNode[] = []

  for (let start = 0; start < branches.length; start += BRANCHES_PER_QUERY) {
    const batch = branches.slice(start, start + BRANCHES_PER_QUERY)
    const variables: Record<string, unknown> = {
      owner: repository.owner,
      name: repository.name,
      since: query.since.toISOString(),
      until: query.until.toISOString(),
    }
    authors.forEach((author, i) => (variables[`author${i}`] = author))
    batch.forEach(
      (branch, i) => (variables[`ref${i}`] = `refs/heads/${branch}`)
    )

    const data = await graphql(
      token,
      buildBatchHistoryQuery(batch.length, authors.length),
      variables
    )
    if (!isRecord(data.repository)) {
      continue
    }

    for (const [branchPosition, branch] of batch.entries()) {
      for (const [authorPosition, author] of authors.entries()) {
        const page = readRefHistory(
          data.repository[`b${branchPosition}`],
          `a${authorPosition}`
        )
        if (page === null) {
          continue
        }
        nodes.push(...page.nodes)
        if (page.nextCursor !== null) {
          nodes.push(
            ...(await fetchRemainingHistory(
              token,
              repository,
              branch,
              author,
              query,
              page.nextCursor
            ))
          )
        }
      }
    }
  }
  return nodes
}

/**
 * Commits authored by the user within the period, on every branch of every
 * repository pushed to since the start of the period. Merge commits and
 * duplicates (same commit on several branches) are removed; oldest first.
 */
export async function fetchCommits(
  token: string,
  query: CommitQuery
): Promise<GithubCommit[]> {
  const repositories = await listActiveRepositories(token, query.since)
  const perRepository = await mapWithConcurrency(
    repositories,
    REPOSITORY_CONCURRENCY,
    (repository) => fetchRepositoryCommits(token, repository, query)
  )

  const commits = new Map<string, HistoryNode>()
  for (const node of perRepository.flat()) {
    const authoredAt = new Date(node.authoredDate)
    // The GraphQL period filter uses the committer date; keep work authored in the period.
    if (
      !node.isMerge &&
      authoredAt >= query.since &&
      authoredAt <= query.until
    ) {
      commits.set(node.oid, node)
    }
  }

  return [...commits.values()]
    .sort((a, b) => Date.parse(a.authoredDate) - Date.parse(b.authoredDate))
    .map((node) => ({ message: node.message, authoredAt: node.authoredDate }))
}
