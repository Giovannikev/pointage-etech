// @ts-nocheck -- single-file build of supabase/functions/user-settings (esbuild); edit the sources, not this file.
// _shared/auth.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// _shared/errors.ts
var HttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
};

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

// _shared/validation.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxLength;
}

// _shared/settings.ts
var INSTANCE_INDEXES = [1, 2];
var MAX_LABEL_LENGTH = 60;
var MAX_FIELD_LENGTH = 255;
var MAX_DB_LENGTH = 63;
var MAX_AUTHOR_EMAILS = 10;
var EMPTY_SETTINGS = { github: null, odooInstances: [] };
function toSettingsView(settings) {
  return {
    github: settings.github === null ? null : {
      login: settings.github.login,
      authorEmails: settings.github.authorEmails
    },
    odooInstances: settings.odooInstances.map(
      ({ index, label, url, db, login }) => ({ index, label, url, db, login })
    )
  };
}
function isInstanceIndex(value) {
  return value === 1 || value === 2;
}
function isOptionalSecret(value) {
  return value === null || isNonEmptyString(value, MAX_FIELD_LENGTH);
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
function parseSettingsUpdate(body) {
  if (!isRecord(body) || !isRecord(body.github)) {
    throw new HttpError("Request body must contain the GitHub settings.", 400);
  }
  const { token, authorEmails } = body.github;
  if (!isOptionalSecret(token)) {
    throw new HttpError("The GitHub token is invalid.", 400);
  }
  if (!isEmailList(authorEmails)) {
    throw new HttpError(
      `Commit emails must be at most ${MAX_AUTHOR_EMAILS} valid addresses.`,
      400
    );
  }
  const rawInstances = body.odooInstances;
  if (!Array.isArray(rawInstances) || rawInstances.length === 0 || rawInstances.length > INSTANCE_INDEXES.length) {
    throw new HttpError(
      `Configure between 1 and ${INSTANCE_INDEXES.length} Odoo instances.`,
      400
    );
  }
  const odooInstances = rawInstances.map((raw, position) => {
    const fields = parseInstanceFields(raw);
    if (fields === null || !isRecord(raw) || !isOptionalSecret(raw.apiKey)) {
      throw new HttpError(`Odoo instance ${position + 1} is invalid.`, 400);
    }
    return { ...fields, apiKey: raw.apiKey === null ? null : raw.apiKey.trim() };
  });
  if (!hasUniqueIndexes(odooInstances)) {
    throw new HttpError("Each Odoo instance must be configured once.", 400);
  }
  return {
    github: {
      token: token === null ? null : token.trim(),
      authorEmails: authorEmails.map((email) => email.trim())
    },
    odooInstances
  };
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
var IV_LENGTH = 12;
var FORMAT_VERSION = "v1";
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
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
async function encryptText(plainText, associatedData) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
    await importKey(),
    encoder.encode(plainText)
  );
  return [FORMAT_VERSION, toBase64(iv), toBase64(new Uint8Array(cipher))].join(
    "."
  );
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
async function saveSettings(userId, settings) {
  const payload = await encryptText(JSON.stringify(settings), userId);
  const { error } = await getAdminClient().from(TABLE).upsert({ user_id: userId, payload, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error !== null) {
    throw new HttpError(`Couldn't save your settings: ${error.message}`, 500);
  }
}

// _shared/github.ts
var API_URL = "https://api.github.com";
var REQUEST_TIMEOUT_MS = 2e4;
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
async function fetchViewer(token) {
  const response = await githubFetch(token, "/user");
  const user = await response.json();
  if (!isRecord(user) || !isNonEmptyString(user.login, 255) || !isNonEmptyString(user.node_id, 255)) {
    throw new HttpError("GitHub returned an invalid user profile.", 502);
  }
  return { login: user.login, nodeId: user.node_id };
}

// _shared/odoo.ts
var RPC_TIMEOUT_MS = 2e4;
var OdooRpcError = class extends HttpError {
  constructor(message) {
    super(message, 502);
    this.name = "OdooRpcError";
  }
};
var rpcRequestId = 0;
function readOdooErrorMessage(error) {
  if (isRecord(error)) {
    if (isRecord(error.data) && typeof error.data.message === "string") {
      return error.data.message;
    }
    if (typeof error.message === "string") {
      return error.message;
    }
  }
  return "Odoo returned an unknown error.";
}
async function postJsonRpc(url, label, params) {
  rpcRequestId += 1;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params,
        id: rpcRequestId
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(`${label} is unreachable (${reason}).`, 502);
  }
  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get("Location") ?? "another address";
    throw new HttpError(
      `${label} redirects to ${target}. Use that URL in Settings.`,
      502
    );
  }
  if (!response.ok) {
    throw new HttpError(`${label} responded with HTTP ${response.status}.`, 502);
  }
  const payload = await response.json().catch(() => null);
  if (!isRecord(payload)) {
    throw new HttpError(`${label} returned an invalid JSON-RPC payload.`, 502);
  }
  if (payload.error !== void 0) {
    throw new OdooRpcError(readOdooErrorMessage(payload.error));
  }
  return payload.result;
}
function callService(connection, service, method, args) {
  return postJsonRpc(`${connection.url}/jsonrpc`, connection.label, {
    service,
    method,
    args
  });
}
async function detectDatabase(url, label) {
  try {
    const databases = await postJsonRpc(`${url}/web/database/list`, label, {});
    if (Array.isArray(databases) && databases.length === 1 && typeof databases[0] === "string") {
      return databases[0];
    }
  } catch (error) {
    if (!(error instanceof OdooRpcError)) {
      throw error;
    }
  }
  throw new HttpError(
    `Couldn't detect the database of ${label}. Enter its name in Settings.`,
    400
  );
}
async function authenticate(connection) {
  let uid;
  try {
    uid = await callService(connection, "common", "authenticate", [
      connection.db,
      connection.login,
      connection.apiKey,
      {}
    ]);
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new OdooRpcError(
        `Authentication failed on ${connection.label}: ${error.message}`
      );
    }
    throw error;
  }
  if (!isPositiveInteger(uid)) {
    throw new OdooRpcError(
      `Authentication failed on ${connection.label}. Check the database, login and API key.`
    );
  }
  return { connection, uid };
}

// user-settings/applySettingsUpdate.ts
async function resolveGithub(stored, update) {
  const token = update.token ?? stored?.token;
  if (token === void 0) {
    throw new HttpError("Enter your GitHub token.", 400);
  }
  if (stored !== null && token === stored.token) {
    return { ...stored, authorEmails: update.authorEmails };
  }
  const viewer = await fetchViewer(token);
  return {
    token,
    login: viewer.login,
    nodeId: viewer.nodeId,
    authorEmails: update.authorEmails
  };
}
function hasSameConnection(a, b) {
  return a.url === b.url && a.db === b.db && a.login === b.login && a.apiKey === b.apiKey;
}
async function resolveOdooInstance(stored, update) {
  const apiKey = update.apiKey ?? stored?.apiKey;
  if (apiKey === void 0) {
    throw new HttpError(`Enter the API key of ${update.label}.`, 400);
  }
  const db = update.db || await detectDatabase(update.url, update.label);
  const instance = { ...update, db, apiKey };
  if (stored === void 0 || !hasSameConnection(stored, instance)) {
    await authenticate(instance);
  }
  return instance;
}
async function applySettingsUpdate(current, update) {
  const [github, odooInstances] = await Promise.all([
    resolveGithub(current.github, update.github),
    Promise.all(
      update.odooInstances.map(
        (instance) => resolveOdooInstance(
          current.odooInstances.find(
            (stored) => stored.index === instance.index
          ),
          instance
        )
      )
    )
  ]);
  return {
    github,
    odooInstances: odooInstances.sort((a, b) => a.index - b.index)
  };
}

// user-settings/index.ts
serveJson("user-settings", {
  GET: async ({ userId }) => toSettingsView(await loadSettings(userId)),
  PUT: async ({ request, userId }) => {
    const update = parseSettingsUpdate(await readJsonBody(request));
    const settings = await applySettingsUpdate(
      await loadSettings(userId),
      update
    );
    await saveSettings(userId, settings);
    return toSettingsView(settings);
  }
});
