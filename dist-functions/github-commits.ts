// @ts-nocheck -- single-file build of supabase/functions/github-commits (esbuild); edit the sources, not this file.
// _shared/errors.ts
var HttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
};

// _shared/validation.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxLength;
}
function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// _shared/github.ts
var API_URL = "https://api.github.com";
var REQUEST_TIMEOUT_MS = 2e4;
var REPOSITORY_CONCURRENCY = 4;
var BRANCHES_PER_QUERY = 20;
var PAGE_SIZE = 100;
var HISTORY_FRAGMENT = `
  fragment History on CommitHistoryConnection {
    pageInfo { hasNextPage endCursor }
    nodes { oid message authoredDate parents { totalCount } }
  }`;
var BRANCH_LIST_QUERY = `
  query ($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { name target { ... on Commit { committedDate } } }
      }
    }
  }`;
var BRANCH_HISTORY_QUERY = `
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
  ${HISTORY_FRAGMENT}`;
async function githubFetch(token, path, init = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(`GitHub is unreachable (${reason}).`, 502);
  }
  if (response.status === 401) {
    throw new HttpError(
      "GitHub rejected your token. Update it in Settings.",
      400
    );
  }
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = new Date(
      Number(response.headers.get("x-ratelimit-reset")) * 1e3
    );
    throw new HttpError(
      `GitHub rate limit reached. Try again after ${reset.toISOString().slice(11, 16)} UTC.`,
      429
    );
  }
  if (!response.ok) {
    throw new HttpError(`GitHub responded with HTTP ${response.status}.`, 502);
  }
  return response;
}
function readNextLink(linkHeader) {
  const next = linkHeader?.split(",").find((part) => part.includes('rel="next"'));
  const match = next?.match(/<([^>]+)>/);
  return match ? match[1].replace(API_URL, "") : null;
}
async function graphql(token, query, variables) {
  const response = await githubFetch(token, "/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new HttpError("GitHub returned an invalid GraphQL response.", 502);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const [first] = payload.errors;
    const message = isRecord(first) && typeof first.message === "string" ? first.message : "unknown error";
    throw new HttpError(`GitHub error: ${message}`, 502);
  }
  if (!isRecord(payload.data)) {
    throw new HttpError("GitHub returned an invalid GraphQL response.", 502);
  }
  return payload.data;
}
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}
function readHistoryPage(value) {
  if (!isRecord(value) || !isRecord(value.pageInfo) || !Array.isArray(value.nodes)) {
    return null;
  }
  const nodes = value.nodes.flatMap((node) => {
    if (!isRecord(node) || typeof node.oid !== "string" || typeof node.message !== "string" || !isIsoTimestamp(node.authoredDate) || !isRecord(node.parents) || typeof node.parents.totalCount !== "number") {
      return [];
    }
    return [
      {
        oid: node.oid,
        message: node.message,
        authoredDate: node.authoredDate,
        isMerge: node.parents.totalCount > 1
      }
    ];
  });
  const { hasNextPage, endCursor } = value.pageInfo;
  return {
    nodes,
    nextCursor: hasNextPage === true && typeof endCursor === "string" ? endCursor : null
  };
}
function readRefHistory(ref, alias) {
  return isRecord(ref) && isRecord(ref.target) ? readHistoryPage(ref.target[alias]) : null;
}
async function listActiveRepositories(token, since) {
  const repositories = [];
  let path = `/user/repos?per_page=${PAGE_SIZE}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`;
  while (path !== null) {
    const response = await githubFetch(token, path);
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new HttpError("GitHub returned an invalid repository list.", 502);
    }
    let reachedOlder = false;
    for (const repo of page) {
      if (!isRecord(repo) || typeof repo.name !== "string" || typeof repo.full_name !== "string" || !isRecord(repo.owner) || typeof repo.owner.login !== "string") {
        continue;
      }
      if (isIsoTimestamp(repo.pushed_at) && new Date(repo.pushed_at) >= since) {
        repositories.push({
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name
        });
      } else {
        reachedOlder = true;
      }
    }
    path = reachedOlder ? null : readNextLink(response.headers.get("Link"));
  }
  return repositories;
}
async function listActiveBranches(token, repository, since) {
  const branches = [];
  let cursor = null;
  do {
    const data = await graphql(token, BRANCH_LIST_QUERY, {
      owner: repository.owner,
      name: repository.name,
      cursor
    });
    const refs = isRecord(data.repository) ? data.repository.refs : null;
    if (!isRecord(refs) || !Array.isArray(refs.nodes) || !isRecord(refs.pageInfo)) {
      return branches;
    }
    for (const ref of refs.nodes) {
      const tipDate = isRecord(ref) && isRecord(ref.target) ? ref.target.committedDate : null;
      if (isRecord(ref) && typeof ref.name === "string" && isIsoTimestamp(tipDate) && new Date(tipDate) >= since) {
        branches.push(ref.name);
      }
    }
    const { hasNextPage, endCursor } = refs.pageInfo;
    cursor = hasNextPage === true && typeof endCursor === "string" ? endCursor : null;
  } while (cursor !== null);
  return branches;
}
function buildBatchHistoryQuery(branchCount, authorCount) {
  const range = (count) => Array.from({ length: count }, (_, i) => i);
  const variables = [
    "$owner: String!",
    "$name: String!",
    "$since: GitTimestamp!",
    "$until: GitTimestamp!",
    ...range(authorCount).map((i) => `$author${i}: CommitAuthor!`),
    ...range(branchCount).map((i) => `$ref${i}: String!`)
  ];
  const histories = range(authorCount).map(
    (i) => `a${i}: history(first: ${PAGE_SIZE}, since: $since, until: $until, author: $author${i}) { ...History }`
  ).join("\n");
  const refs = range(branchCount).map(
    (i) => `b${i}: ref(qualifiedName: $ref${i}) { target { ... on Commit { ${histories} } } }`
  ).join("\n");
  return `query (${variables.join(", ")}) {
    repository(owner: $owner, name: $name) { ${refs} }
  }
  ${HISTORY_FRAGMENT}`;
}
async function fetchRemainingHistory(token, repository, branch, author, query, firstCursor) {
  const nodes = [];
  let cursor = firstCursor;
  while (cursor !== null) {
    const data = await graphql(token, BRANCH_HISTORY_QUERY, {
      owner: repository.owner,
      name: repository.name,
      ref: `refs/heads/${branch}`,
      since: query.since.toISOString(),
      until: query.until.toISOString(),
      author,
      cursor
    });
    const ref = isRecord(data.repository) ? data.repository.ref : null;
    const page = readRefHistory(ref, "history");
    if (page === null) {
      break;
    }
    nodes.push(...page.nodes);
    cursor = page.nextCursor;
  }
  return nodes;
}
async function fetchRepositoryCommits(token, repository, query) {
  const branches = await listActiveBranches(token, repository, query.since);
  const authors = [
    { id: query.authorNodeId },
    ...query.authorEmails.length > 0 ? [{ emails: query.authorEmails }] : []
  ];
  const nodes = [];
  for (let start = 0; start < branches.length; start += BRANCHES_PER_QUERY) {
    const batch = branches.slice(start, start + BRANCHES_PER_QUERY);
    const variables = {
      owner: repository.owner,
      name: repository.name,
      since: query.since.toISOString(),
      until: query.until.toISOString()
    };
    authors.forEach((author, i) => variables[`author${i}`] = author);
    batch.forEach(
      (branch, i) => variables[`ref${i}`] = `refs/heads/${branch}`
    );
    const data = await graphql(
      token,
      buildBatchHistoryQuery(batch.length, authors.length),
      variables
    );
    if (!isRecord(data.repository)) {
      continue;
    }
    for (const [branchPosition, branch] of batch.entries()) {
      for (const [authorPosition, author] of authors.entries()) {
        const page = readRefHistory(
          data.repository[`b${branchPosition}`],
          `a${authorPosition}`
        );
        if (page === null) {
          continue;
        }
        nodes.push(...page.nodes);
        if (page.nextCursor !== null) {
          nodes.push(
            ...await fetchRemainingHistory(
              token,
              repository,
              branch,
              author,
              query,
              page.nextCursor
            )
          );
        }
      }
    }
  }
  return nodes;
}
async function fetchCommits(token, query) {
  const repositories = await listActiveRepositories(token, query.since);
  const perRepository = await mapWithConcurrency(
    repositories,
    REPOSITORY_CONCURRENCY,
    (repository) => fetchRepositoryCommits(token, repository, query)
  );
  const commits = /* @__PURE__ */ new Map();
  for (const node of perRepository.flat()) {
    const authoredAt = new Date(node.authoredDate);
    if (!node.isMerge && authoredAt >= query.since && authoredAt <= query.until) {
      commits.set(node.oid, node);
    }
  }
  return [...commits.values()].sort((a, b) => Date.parse(a.authoredDate) - Date.parse(b.authoredDate)).map((node) => ({ message: node.message, authoredAt: node.authoredDate }));
}

// _shared/auth.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// _shared/env.ts
function readEnv(name) {
  const value = Deno.env.get(name)?.trim();
  return value === void 0 || value === "" ? null : value;
}
function requireEnv(name) {
  const value = readEnv(name);
  if (value === null) {
    throw new HttpError(`Server misconfigured: ${name} is not set.`, 500);
  }
  return value;
}

// _shared/auth.ts
var adminClient = null;
function getAdminClient() {
  adminClient ??= createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
  return adminClient;
}
async function requireUserId(request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token === void 0 || token === "") {
    throw new HttpError("Sign in to use Pointage.", 401);
  }
  const { data, error } = await getAdminClient().auth.getUser(token);
  if (error !== null || data.user === null) {
    throw new HttpError("Your session has expired. Sign in again.", 401);
  }
  return data.user.id;
}

// _shared/http.ts
function parseAllowedOrigins(value) {
  if (value === null) {
    return null;
  }
  const origins = value.split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter((origin) => origin !== "");
  return origins.length === 0 || origins.includes("*") ? null : origins;
}
function resolveAllowedOrigin(allowed, requestOrigin) {
  if (allowed === null) {
    return "*";
  }
  return requestOrigin !== null && allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
}
function corsHeaders(request, allowedMethods) {
  const allowed = parseAllowedOrigins(readEnv("ALLOWED_ORIGIN"));
  const headers = {
    "Access-Control-Allow-Origin": resolveAllowedOrigin(
      allowed,
      request.headers.get("Origin")
    ),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": allowedMethods
  };
  if (allowed !== null) {
    headers.Vary = "Origin";
  }
  return headers;
}
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must be valid JSON.", 400);
  }
}
function serveJson(functionName, handlers) {
  const methods = Object.keys(handlers);
  const allowedMethods = ["OPTIONS", ...methods].join(", ");
  Deno.serve(async (request) => {
    const headers = corsHeaders(request, allowedMethods);
    const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" }
    });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    const handler = methods.includes(request.method) ? handlers[request.method] : void 0;
    if (handler === void 0) {
      return jsonResponse(
        { error: `Method not allowed. Use ${methods.join(" or ")}.` },
        405
      );
    }
    try {
      const userId = await requireUserId(request);
      return jsonResponse(await handler({ request, userId }));
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      console.error(`${functionName}: unexpected error`, error);
      return jsonResponse({ error: "Unexpected server error." }, 500);
    }
  });
}

// _shared/settings.ts
var MAX_LABEL_LENGTH = 60;
var MAX_FIELD_LENGTH = 255;
var MAX_DB_LENGTH = 63;
var MAX_AUTHOR_EMAILS = 10;
var EMPTY_SETTINGS = { github: null, odooInstances: [] };
function requireGithub(settings) {
  if (settings.github === null) {
    throw new HttpError("Add your GitHub token in Settings first.", 400);
  }
  return settings.github;
}
function isInstanceIndex(value) {
  return value === 1 || value === 2;
}
function isEmailList(value) {
  return Array.isArray(value) && value.length <= MAX_AUTHOR_EMAILS && value.every(
    (email) => isNonEmptyString(email, MAX_FIELD_LENGTH) && email.includes("@")
  );
}
function normalizeOdooUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
function parseInstanceFields(value) {
  if (!isRecord(value)) {
    return null;
  }
  const url = normalizeOdooUrl(value.url);
  if (!isInstanceIndex(value.index) || !isNonEmptyString(value.label, MAX_LABEL_LENGTH) || url === null || typeof value.db !== "string" || value.db.length > MAX_DB_LENGTH || !isNonEmptyString(value.login, MAX_FIELD_LENGTH)) {
    return null;
  }
  return {
    index: value.index,
    label: value.label.trim(),
    url,
    db: value.db.trim(),
    login: value.login.trim()
  };
}
function hasUniqueIndexes(instances) {
  return new Set(instances.map((instance) => instance.index)).size === instances.length;
}
function parseStoredSettings(value) {
  const invalid = new HttpError(
    "Your stored settings are invalid. Save them again.",
    500
  );
  if (!isRecord(value) || !Array.isArray(value.odooInstances)) {
    throw invalid;
  }
  let github = null;
  if (value.github !== null) {
    const stored = value.github;
    if (!isRecord(stored) || !isNonEmptyString(stored.token, MAX_FIELD_LENGTH) || !isNonEmptyString(stored.login, MAX_FIELD_LENGTH) || !isNonEmptyString(stored.nodeId, MAX_FIELD_LENGTH) || !isEmailList(stored.authorEmails)) {
      throw invalid;
    }
    github = {
      token: stored.token,
      login: stored.login,
      nodeId: stored.nodeId,
      authorEmails: stored.authorEmails
    };
  }
  const odooInstances = value.odooInstances.map((stored) => {
    const fields = parseInstanceFields(stored);
    if (fields === null || !isRecord(stored) || !isNonEmptyString(stored.apiKey, MAX_FIELD_LENGTH)) {
      throw invalid;
    }
    return { ...fields, apiKey: stored.apiKey };
  });
  if (!hasUniqueIndexes(odooInstances)) {
    throw invalid;
  }
  return { github, odooInstances };
}

// _shared/crypto.ts
var KEY_ENV = "CREDENTIALS_ENCRYPTION_KEY";
var KEY_LENGTH = 32;
var FORMAT_VERSION = "v1";
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function decodeKey(encoded) {
  try {
    return fromBase64(encoded);
  } catch {
    return null;
  }
}
function importKey() {
  const raw = decodeKey(requireEnv(KEY_ENV));
  if (raw === null || raw.length !== KEY_LENGTH) {
    throw new HttpError(
      `Server misconfigured: ${KEY_ENV} must be ${KEY_LENGTH} bytes encoded in base64.`,
      500
    );
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}
async function decryptText(payload, associatedData) {
  const [version, iv, cipher] = payload.split(".");
  if (version !== FORMAT_VERSION || iv === void 0 || cipher === void 0) {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    );
  }
  const key = await importKey();
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(iv),
        additionalData: encoder.encode(associatedData)
      },
      key,
      fromBase64(cipher)
    );
    return decoder.decode(plain);
  } catch {
    throw new HttpError(
      "Your stored settings can't be decrypted. Save them again.",
      500
    );
  }
}

// _shared/settingsStore.ts
var TABLE = "user_settings";
async function loadSettings(userId) {
  const { data, error } = await getAdminClient().from(TABLE).select("payload").eq("user_id", userId).maybeSingle();
  if (error !== null) {
    throw new HttpError(`Couldn't load your settings: ${error.message}`, 500);
  }
  if (data === null) {
    return EMPTY_SETTINGS;
  }
  if (!isRecord(data) || typeof data.payload !== "string") {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    );
  }
  const plainText = await decryptText(data.payload, userId);
  return parseStoredSettings(JSON.parse(plainText));
}

// github-commits/index.ts
var MAX_PERIOD_DAYS = 366;
var MAX_PERIOD_MS = (MAX_PERIOD_DAYS + 1) * 24 * 60 * 60 * 1e3;
function parsePeriod(body) {
  if (!isRecord(body) || !isIsoTimestamp(body.since) || !isIsoTimestamp(body.until)) {
    throw new HttpError('Send "since" and "until" as ISO timestamps.', 400);
  }
  const since = new Date(body.since);
  const until = new Date(body.until);
  if (since > until) {
    throw new HttpError("The period must start before it ends.", 400);
  }
  if (until.getTime() - since.getTime() > MAX_PERIOD_MS) {
    throw new HttpError(
      `The period can't be longer than ${MAX_PERIOD_DAYS} days.`,
      400
    );
  }
  return { since, until };
}
serveJson("github-commits", {
  POST: async ({ request, userId }) => {
    const period = parsePeriod(await readJsonBody(request));
    const github = requireGithub(await loadSettings(userId));
    const commits = await fetchCommits(github.token, {
      ...period,
      authorNodeId: github.nodeId,
      authorEmails: github.authorEmails
    });
    return { commits };
  }
});
