// @ts-nocheck -- single-file build of supabase/functions/odoo-gateway (esbuild); edit the sources, not this file.
// _shared/errors.ts
var HttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
};

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
function executeKw(session, model, method, args, kwargs = {}) {
  const { connection, uid } = session;
  return callService(connection, "object", "execute_kw", [
    connection.db,
    uid,
    connection.apiKey,
    model,
    method,
    args,
    kwargs
  ]);
}
function createSessionPool(instances) {
  const sessions = /* @__PURE__ */ new Map();
  return (index) => {
    let session = sessions.get(index);
    if (session === void 0) {
      const instance = instances.find((candidate) => candidate.index === index);
      session = instance === void 0 ? Promise.reject(
        new HttpError(`Odoo instance ${index} is not configured.`, 400)
      ) : authenticate(instance);
      sessions.set(index, session);
    }
    return session;
  };
}
function readMany2one(value) {
  if (Array.isArray(value) && isPositiveInteger(value[0]) && typeof value[1] === "string") {
    return { id: value[0], name: value[1] };
  }
  return null;
}

// _shared/settings.ts
var INSTANCE_INDEXES = [1, 2];
var MAX_LABEL_LENGTH = 60;
var MAX_FIELD_LENGTH = 255;
var MAX_DB_LENGTH = 63;
var MAX_AUTHOR_EMAILS = 10;
var EMPTY_SETTINGS = { github: null, odooInstances: [] };
function requireOdooInstances(settings) {
  if (settings.odooInstances.length === 0) {
    throw new HttpError("Add an Odoo instance in Settings first.", 400);
  }
  return settings.odooInstances;
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

// odoo-gateway/index.ts
var MAX_ITEMS_PER_REQUEST = 100;
var MAX_LOOKUPS_PER_REQUEST = 500;
var TIMESHEET_LOOKUP_LIMIT = 2e3;
var MAX_TASK_REF_LENGTH = 64;
var MAX_DESCRIPTION_LENGTH = 2e3;
var TASK_CANDIDATE_LIMIT = 20;
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var MY_TASKS_LIMIT = 1e3;
var HISTORY_LIMIT = 2e3;
var MAX_HISTORY_DAYS = 366;
var SEARCH_LIMIT = 50;
var MY_TICKETS_LIMIT = 200;
var MIN_QUERY_LENGTH = 2;
var MAX_QUERY_LENGTH = 100;
var MS_PER_DAY = 864e5;
function isInstanceIndex2(value) {
  return value === 1 || value === 2;
}
function readBatch(value, field, maxItems = MAX_ITEMS_PER_REQUEST) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new HttpError(
      `"${field}" must be a non-empty array of at most ${maxItems} items.`,
      400
    );
  }
  return value;
}
function parseLookup(value, position) {
  if (isRecord(value) && isInstanceIndex2(value.instanceIndex) && isPositiveInteger(value.taskId) && typeof value.date === "string" && ISO_DATE.test(value.date)) {
    return {
      instanceIndex: value.instanceIndex,
      taskId: value.taskId,
      date: value.date
    };
  }
  throw new HttpError(`Lookup ${position + 1} is invalid.`, 400);
}
function parseSubmission(value, position) {
  if (isRecord(value) && isNonEmptyString(value.clientId, 100) && isPositiveInteger(value.taskId) && isPositiveInteger(value.projectId) && typeof value.hours === "number" && value.hours > 0 && value.hours <= 24 && isNonEmptyString(value.description, MAX_DESCRIPTION_LENGTH) && typeof value.date === "string" && ISO_DATE.test(value.date) && isInstanceIndex2(value.instanceIndex)) {
    return {
      clientId: value.clientId,
      taskId: value.taskId,
      projectId: value.projectId,
      hours: value.hours,
      description: value.description.trim(),
      date: value.date,
      instanceIndex: value.instanceIndex
    };
  }
  throw new HttpError(`Entry ${position + 1} is invalid.`, 400);
}
function isValidHours(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 24;
}
function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function readOptionalInstance(value) {
  if (value === void 0 || value === null) {
    return null;
  }
  if (isInstanceIndex2(value)) {
    return value;
  }
  throw new HttpError('"instanceIndex" must be 1 or 2 when given.', 400);
}
function parseTimesheetReference(body) {
  if (!isInstanceIndex2(body.instanceIndex) || !isPositiveInteger(body.timesheetId)) {
    throw new HttpError('"instanceIndex" and "timesheetId" are required.', 400);
  }
  return { instanceIndex: body.instanceIndex, timesheetId: body.timesheetId };
}
function parseHistoryQuery(body) {
  const { dateFrom, dateTo } = body;
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
    throw new HttpError(
      '"dateFrom" and "dateTo" must be dates (YYYY-MM-DD).',
      400
    );
  }
  const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / MS_PER_DAY + 1;
  if (days < 1 || days > MAX_HISTORY_DAYS) {
    throw new HttpError(
      `The period must run forward and last at most ${MAX_HISTORY_DAYS} days.`,
      400
    );
  }
  return {
    dateFrom,
    dateTo,
    instanceIndex: readOptionalInstance(body.instanceIndex)
  };
}
function readQuery(value, optional) {
  const query = typeof value === "string" ? value.trim() : "";
  if (optional && query === "") {
    return "";
  }
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    throw new HttpError(
      `"query" must be ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters.`,
      400
    );
  }
  return query;
}
function parseRequest(body) {
  if (!isRecord(body)) {
    throw new HttpError("Request body must be a JSON object.", 400);
  }
  if (body.action === "SEARCH_TASK") {
    const taskRefs = readBatch(body.taskRefs, "taskRefs").map((ref) => {
      if (!isNonEmptyString(ref, MAX_TASK_REF_LENGTH)) {
        throw new HttpError("Every task reference must be a short string.", 400);
      }
      return ref.trim();
    });
    return { action: "SEARCH_TASK", taskRefs: [...new Set(taskRefs)] };
  }
  if (body.action === "SUBMIT_TIMESHEET") {
    const entries = readBatch(body.entries, "entries").map(parseSubmission);
    return { action: "SUBMIT_TIMESHEET", entries };
  }
  if (body.action === "GET_TASK") {
    if (!isInstanceIndex2(body.instanceIndex) || !isPositiveInteger(body.taskId)) {
      throw new HttpError('"instanceIndex" and "taskId" are required.', 400);
    }
    return {
      action: "GET_TASK",
      instanceIndex: body.instanceIndex,
      taskId: body.taskId
    };
  }
  if (body.action === "FIND_TIMESHEETS") {
    const lookups = readBatch(
      body.lookups,
      "lookups",
      MAX_LOOKUPS_PER_REQUEST
    ).map(parseLookup);
    return { action: "FIND_TIMESHEETS", lookups };
  }
  if (body.action === "GET_MY_TASKS") {
    return {
      action: "GET_MY_TASKS",
      instanceIndex: readOptionalInstance(body.instanceIndex)
    };
  }
  if (body.action === "GET_TIMESHEET_HISTORY") {
    return { action: "GET_TIMESHEET_HISTORY", ...parseHistoryQuery(body) };
  }
  if (body.action === "UPDATE_TIMESHEET") {
    const reference = parseTimesheetReference(body);
    if (!isValidHours(body.hours)) {
      throw new HttpError('"hours" must be between 0 and 24.', 400);
    }
    if (!isNonEmptyString(body.description, MAX_DESCRIPTION_LENGTH)) {
      throw new HttpError(
        `"description" must be a non-empty text of at most ${MAX_DESCRIPTION_LENGTH} characters.`,
        400
      );
    }
    return {
      action: "UPDATE_TIMESHEET",
      ...reference,
      hours: body.hours,
      description: body.description.trim()
    };
  }
  if (body.action === "DELETE_TIMESHEET") {
    return { action: "DELETE_TIMESHEET", ...parseTimesheetReference(body) };
  }
  if (body.action === "SEARCH_TASKS") {
    return {
      action: "SEARCH_TASKS",
      query: readQuery(body.query, false),
      instanceIndex: readOptionalInstance(body.instanceIndex)
    };
  }
  if (body.action === "SEARCH_TICKETS") {
    const mine = body.mine === true;
    return {
      action: "SEARCH_TICKETS",
      mine,
      query: readQuery(body.query, mine),
      instanceIndex: readOptionalInstance(body.instanceIndex)
    };
  }
  if (body.action === "LOG_TICKET_TIME") {
    if (!isInstanceIndex2(body.instanceIndex) || !isPositiveInteger(body.ticketId) || !isValidHours(body.hours) || !isNonEmptyString(body.description, MAX_DESCRIPTION_LENGTH) || !isIsoDate(body.date)) {
      throw new HttpError(
        '"instanceIndex", "ticketId", "hours", "description" and "date" are required.',
        400
      );
    }
    return {
      action: "LOG_TICKET_TIME",
      instanceIndex: body.instanceIndex,
      ticketId: body.ticketId,
      hours: body.hours,
      description: body.description.trim(),
      date: body.date
    };
  }
  throw new HttpError(
    'Unknown action. Use "SEARCH_TASK", "SUBMIT_TIMESHEET", "FIND_TIMESHEETS", "GET_TASK", "GET_MY_TASKS", "GET_TIMESHEET_HISTORY", "UPDATE_TIMESHEET", "DELETE_TIMESHEET", "SEARCH_TASKS", "SEARCH_TICKETS" or "LOG_TICKET_TIME".',
    400
  );
}
var FIELDS_CACHE_TTL_MS = 10 * 6e4;
var fieldsCache = /* @__PURE__ */ new Map();
async function getModelFields(session, model) {
  const { url, db } = session.connection;
  const key = `${url}|${db}|${model}`;
  const cached = fieldsCache.get(key);
  if (cached !== void 0 && cached.expiresAt > Date.now()) {
    return cached.fields;
  }
  const description = await executeKw(session, model, "fields_get", [], {
    attributes: ["type"]
  });
  if (!isRecord(description)) {
    throw new HttpError(
      `${session.connection.label} didn't describe the ${model} fields.`,
      502
    );
  }
  const fields = new Set(Object.keys(description));
  fieldsCache.set(key, { fields, expiresAt: Date.now() + FIELDS_CACHE_TTL_MS });
  return fields;
}
var TICKET_LINK_FIELDS = ["helpdesk_ticket_id", "ticket_id"];
function findTicketLinkField(lineFields) {
  return TICKET_LINK_FIELDS.find((field) => lineFields.has(field)) ?? null;
}
async function timesheetFields(session, base) {
  const fields = await getModelFields(session, "account.analytic.line");
  const ticketLink = findTicketLinkField(fields);
  return [
    ...base,
    ...fields.has("validated") ? ["validated"] : [],
    ...ticketLink === null ? [] : [ticketLink]
  ];
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function containsWholeRef(value, taskRef) {
  if (typeof value !== "string") {
    return false;
  }
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9-])${escapeRegExp(taskRef)}($|[^A-Za-z0-9-])`,
    "i"
  );
  return pattern.test(value);
}
async function findTask(session, instanceIndex, taskRef) {
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [[["name", "ilike", taskRef]]],
    {
      fields: ["id", "name", "project_id"],
      limit: TASK_CANDIDATE_LIMIT,
      order: "id desc"
    }
  );
  if (!Array.isArray(records)) {
    throw new HttpError(
      `${session.connection.label} returned an invalid task list.`,
      502
    );
  }
  for (const record of records) {
    if (!isRecord(record) || !containsWholeRef(record.name, taskRef)) {
      continue;
    }
    const project = readMany2one(record.project_id);
    if (isPositiveInteger(record.id) && typeof record.name === "string" && project !== null) {
      return {
        taskId: record.id,
        taskName: record.name,
        projectId: project.id,
        projectName: project.name,
        instanceIndex
      };
    }
  }
  return null;
}
async function searchTasks(instances, taskRefs) {
  const getSession = createSessionPool(instances);
  const matches = /* @__PURE__ */ new Map();
  let pending = taskRefs;
  for (const { index } of instances) {
    if (pending.length === 0) {
      break;
    }
    const session = await getSession(index);
    const found = await Promise.all(
      pending.map((taskRef) => findTask(session, index, taskRef))
    );
    found.forEach((match, position) => {
      if (match !== null) {
        matches.set(pending[position], match);
      }
    });
    pending = pending.filter((taskRef) => !matches.has(taskRef));
  }
  return taskRefs.map((taskRef) => {
    const match = matches.get(taskRef);
    return match === void 0 ? { taskRef, found: false } : { taskRef, found: true, ...match };
  });
}
async function createTimesheet(session, entry) {
  try {
    const timesheetId = await executeKw(
      session,
      "account.analytic.line",
      "create",
      [
        {
          name: entry.description,
          project_id: entry.projectId,
          task_id: entry.taskId,
          unit_amount: entry.hours,
          date: entry.date
        }
      ]
    );
    if (!isPositiveInteger(timesheetId)) {
      return {
        clientId: entry.clientId,
        success: false,
        error: "Odoo didn't return the new timesheet id."
      };
    }
    return { clientId: entry.clientId, success: true, timesheetId };
  } catch (error) {
    if (error instanceof OdooRpcError) {
      return { clientId: entry.clientId, success: false, error: error.message };
    }
    throw error;
  }
}
async function submitTimesheets(instances, entries) {
  const getSession = createSessionPool(instances);
  const results = /* @__PURE__ */ new Map();
  for (const index of new Set(entries.map((entry) => entry.instanceIndex))) {
    const instanceEntries = entries.filter((e) => e.instanceIndex === index);
    let session;
    try {
      session = await getSession(index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of instanceEntries) {
        results.set(entry.clientId, {
          clientId: entry.clientId,
          success: false,
          error: message
        });
      }
      continue;
    }
    for (const entry of instanceEntries) {
      results.set(entry.clientId, await createTimesheet(session, entry));
    }
  }
  return entries.flatMap((entry) => {
    const result = results.get(entry.clientId);
    return result === void 0 ? [] : [result];
  });
}
function lookupKey({ instanceIndex, taskId, date }) {
  return `${instanceIndex}:${taskId}:${date}`;
}
function readLoggedTimesheet(record, instanceIndex) {
  if (!isRecord(record)) {
    return null;
  }
  const task = readMany2one(record.task_id);
  if (!isPositiveInteger(record.id) || task === null || typeof record.date !== "string" || typeof record.unit_amount !== "number") {
    return null;
  }
  return {
    instanceIndex,
    taskId: task.id,
    date: record.date,
    timesheetId: record.id,
    hours: record.unit_amount,
    description: typeof record.name === "string" ? record.name : "",
    locked: record.validated === true
  };
}
async function findTimesheets(instances, lookups) {
  const getSession = createSessionPool(instances);
  const wanted = new Set(lookups.map(lookupKey));
  const timesheets = [];
  for (const index of new Set(lookups.map((lookup) => lookup.instanceIndex))) {
    const instanceLookups = lookups.filter((l) => l.instanceIndex === index);
    const taskIds = [...new Set(instanceLookups.map((l) => l.taskId))];
    const dates = instanceLookups.map((l) => l.date).sort();
    const session = await getSession(index);
    const records = await executeKw(
      session,
      "account.analytic.line",
      "search_read",
      [
        [
          ["user_id", "=", session.uid],
          ["task_id", "in", taskIds],
          ["date", ">=", dates[0]],
          ["date", "<=", dates[dates.length - 1]]
        ]
      ],
      {
        fields: await timesheetFields(session, [
          "task_id",
          "date",
          "unit_amount",
          "name"
        ]),
        limit: TIMESHEET_LOOKUP_LIMIT
      }
    );
    if (!Array.isArray(records)) {
      throw new HttpError(
        `${session.connection.label} returned an invalid timesheet list.`,
        502
      );
    }
    for (const record of records) {
      const timesheet = readLoggedTimesheet(record, index);
      if (timesheet !== null && wanted.has(lookupKey(timesheet))) {
        timesheets.push(timesheet);
      }
    }
  }
  return timesheets;
}
async function getTask(instances, { instanceIndex, taskId }) {
  const session = await createSessionPool(instances)(instanceIndex);
  const records = await executeKw(session, "project.task", "read", [[taskId]], {
    fields: ["name", "description", "project_id", "stage_id"]
  });
  const record = Array.isArray(records) ? records[0] : void 0;
  if (!isRecord(record) || typeof record.name !== "string") {
    throw new HttpError("This task can't be read in Odoo.", 404);
  }
  return {
    taskId,
    name: record.name,
    descriptionHtml: typeof record.description === "string" ? record.description : "",
    projectName: readMany2one(record.project_id)?.name ?? null,
    stageName: readMany2one(record.stage_id)?.name ?? null
  };
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function selectInstances(instances, instanceIndex) {
  const configured = INSTANCE_INDEXES.filter(
    (index) => instances.some((instance) => instance.index === index)
  );
  if (instanceIndex === null) {
    return configured;
  }
  if (!configured.includes(instanceIndex)) {
    throw new HttpError(
      `Odoo instance ${instanceIndex} is not configured.`,
      400
    );
  }
  return [instanceIndex];
}
function readEachInstance(instances, indexes, read) {
  const getSession = createSessionPool(instances);
  return Promise.all(
    indexes.map(async (index) => {
      try {
        const data = await read(await getSession(index), index);
        return { instanceIndex: index, ok: true, ...data };
      } catch (error) {
        if (error instanceof HttpError) {
          return { instanceIndex: index, ok: false, error: errorMessage(error) };
        }
        throw error;
      }
    })
  );
}
function readRecords(value, session, what) {
  if (!Array.isArray(value)) {
    throw new HttpError(
      `${session.connection.label} returned an invalid ${what} list.`,
      502
    );
  }
  return value;
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function readDate(value) {
  return typeof value === "string" && ISO_DATE.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}
function readDeadline(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(value);
  if (match === null) {
    return null;
  }
  return match[2] === void 0 ? match[1] : `${match[1]}T${match[2]}Z`;
}
var BASE_TASK_FIELDS = [
  "id",
  "name",
  "project_id",
  "stage_id",
  "priority",
  "date_deadline"
];
async function detectTaskFields(session) {
  const available = await getModelFields(session, "project.task");
  const has = (field) => available.has(field);
  const { uid } = session;
  let assigneeDomain;
  if (has("user_id") && has("user_ids")) {
    assigneeDomain = [
      "&",
      ["active", "=", true],
      "|",
      ["user_id", "=", uid],
      ["user_ids", "in", [uid]]
    ];
  } else if (has("user_ids")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_ids", "in", [uid]]
    ];
  } else if (has("user_id")) {
    assigneeDomain = [
      ["active", "=", true],
      ["user_id", "=", uid]
    ];
  } else {
    throw new HttpError(
      `${session.connection.label} has no task assignee field.`,
      502
    );
  }
  const plannedField = has("allocated_hours") ? "allocated_hours" : has("planned_hours") ? "planned_hours" : null;
  const statusField = has("kanban_state") ? "kanban_state" : has("state") ? "state" : null;
  const hasEffectiveHours = has("effective_hours");
  const fields = BASE_TASK_FIELDS.filter(has);
  if (plannedField !== null) fields.push(plannedField);
  if (statusField !== null) fields.push(statusField);
  if (hasEffectiveHours) fields.push("effective_hours");
  return {
    assigneeDomain,
    fields,
    plannedField,
    statusField,
    hasEffectiveHours
  };
}
var KANBAN_STATE_STATUSES = {
  normal: "in_progress",
  done: "approved",
  blocked: "blocked"
};
var STATE_STATUSES = {
  "01_in_progress": "in_progress",
  "02_changes_requested": "changes_requested",
  "03_approved": "approved",
  "04_waiting_normal": "waiting",
  "1_done": "done",
  "1_canceled": "canceled"
};
function readTaskStatus(value, field) {
  if (typeof value !== "string" || field === null) {
    return null;
  }
  const statuses = field === "kanban_state" ? KANBAN_STATE_STATUSES : STATE_STATUSES;
  return statuses[value] ?? null;
}
function readKanbanTask(record, instanceIndex, support) {
  if (!isRecord(record) || !isPositiveInteger(record.id) || typeof record.name !== "string") {
    return null;
  }
  const project = readMany2one(record.project_id);
  const stage = readMany2one(record.stage_id);
  const priority = Number(record.priority);
  const planned = support.plannedField === null ? null : readNumber(record[support.plannedField]);
  return {
    instanceIndex,
    taskId: record.id,
    name: record.name,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    stageId: stage?.id ?? null,
    stageName: stage?.name ?? null,
    priority: Number.isInteger(priority) && priority > 0 ? priority : 0,
    deadline: readDeadline(record.date_deadline),
    status: readTaskStatus(
      support.statusField === null ? void 0 : record[support.statusField],
      support.statusField
    ),
    plannedHours: planned !== null && planned > 0 ? planned : null,
    effectiveHours: support.hasEffectiveHours ? readNumber(record.effective_hours) ?? 0 : null
  };
}
function readKanbanStage(record, instanceIndex) {
  if (!isRecord(record) || !isPositiveInteger(record.id) || typeof record.name !== "string") {
    return null;
  }
  return {
    instanceIndex,
    stageId: record.id,
    name: record.name,
    sequence: readNumber(record.sequence) ?? 0,
    folded: record.fold === true
  };
}
async function readStages(session, instanceIndex, tasks) {
  const projectIds = [...new Set(tasks.flatMap((task) => task.projectId ?? []))];
  const stageIds = [...new Set(tasks.flatMap((task) => task.stageId ?? []))];
  if (projectIds.length === 0 && stageIds.length === 0) {
    return [];
  }
  const records = await executeKw(
    session,
    "project.task.type",
    "search_read",
    [["|", ["id", "in", stageIds], ["project_ids", "in", projectIds]]],
    {
      fields: ["id", "name", "sequence", "fold"],
      order: "sequence asc, id asc"
    }
  );
  return readRecords(records, session, "stage").flatMap(
    (record) => readKanbanStage(record, instanceIndex) ?? []
  );
}
async function readMyTasks(session, instanceIndex) {
  const support = await detectTaskFields(session);
  const records = await executeKw(
    session,
    "project.task",
    "search_read",
    [support.assigneeDomain],
    {
      fields: support.fields,
      limit: MY_TASKS_LIMIT,
      order: "priority desc, id desc"
    }
  );
  const rawTasks = readRecords(records, session, "task");
  const tasks = rawTasks.flatMap(
    (record) => readKanbanTask(record, instanceIndex, support) ?? []
  );
  const stages = await readStages(session, instanceIndex, tasks);
  return { tasks, stages, truncated: rawTasks.length >= MY_TASKS_LIMIT };
}
function getMyTasks(instances, instanceIndex) {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    readMyTasks
  );
}
var HISTORY_FIELDS = [
  "id",
  "name",
  "unit_amount",
  "date",
  "project_id",
  "task_id"
];
function readHistoryEntry(record, instanceIndex) {
  if (!isRecord(record) || !isPositiveInteger(record.id)) {
    return null;
  }
  const date = readDate(record.date);
  const hours = readNumber(record.unit_amount);
  if (date === null || hours === null) {
    return null;
  }
  const project = readMany2one(record.project_id);
  const task = readMany2one(record.task_id);
  const ticket = readMany2one(record.helpdesk_ticket_id) ?? readMany2one(record.ticket_id);
  return {
    instanceIndex,
    timesheetId: record.id,
    date,
    description: typeof record.name === "string" ? record.name : "",
    hours,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    taskId: task?.id ?? null,
    taskName: task?.name ?? null,
    ticketId: ticket?.id ?? null,
    ticketName: ticket?.name ?? null,
    locked: record.validated === true
  };
}
function getTimesheetHistory(instances, { dateFrom, dateTo, instanceIndex }) {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const records = await executeKw(
        session,
        "account.analytic.line",
        "search_read",
        [
          [
            ["user_id", "=", session.uid],
            ["project_id", "!=", false],
            ["date", ">=", dateFrom],
            ["date", "<=", dateTo]
          ]
        ],
        {
          fields: await timesheetFields(session, HISTORY_FIELDS),
          limit: HISTORY_LIMIT,
          order: "date desc, id desc"
        }
      );
      const rawEntries = readRecords(records, session, "timesheet");
      return {
        entries: rawEntries.flatMap(
          (record) => readHistoryEntry(record, index) ?? []
        ),
        truncated: rawEntries.length >= HISTORY_LIMIT
      };
    }
  );
}
async function readOwnTimesheet(session, instanceIndex, timesheetId) {
  const records = await executeKw(
    session,
    "account.analytic.line",
    "search_read",
    [
      [
        ["id", "=", timesheetId],
        ["user_id", "=", session.uid]
      ]
    ],
    { fields: await timesheetFields(session, HISTORY_FIELDS), limit: 1 }
  );
  const entry = readHistoryEntry(
    readRecords(records, session, "timesheet")[0],
    instanceIndex
  );
  if (entry === null) {
    throw new HttpError(
      `Timesheet ${timesheetId} doesn't exist in ${session.connection.label}, or isn't yours.`,
      404
    );
  }
  return entry;
}
function requireUnlocked(entry) {
  if (entry.locked) {
    throw new HttpError(
      "This timesheet is validated in Odoo and can't be changed anymore.",
      409
    );
  }
}
async function asConflict(operation) {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new HttpError(error.message, 409);
    }
    throw error;
  }
}
async function updateTimesheet(instances, { instanceIndex, timesheetId, hours, description }) {
  const session = await createSessionPool(instances)(instanceIndex);
  requireUnlocked(await readOwnTimesheet(session, instanceIndex, timesheetId));
  const written = await asConflict(
    executeKw(session, "account.analytic.line", "write", [
      [timesheetId],
      { unit_amount: hours, name: description }
    ])
  );
  if (written !== true) {
    throw new HttpError("Odoo didn't confirm the update.", 502);
  }
  return readOwnTimesheet(session, instanceIndex, timesheetId);
}
async function deleteTimesheet(instances, { instanceIndex, timesheetId }) {
  const session = await createSessionPool(instances)(instanceIndex);
  requireUnlocked(await readOwnTimesheet(session, instanceIndex, timesheetId));
  const deleted = await asConflict(
    executeKw(session, "account.analytic.line", "unlink", [[timesheetId]])
  );
  if (deleted !== true) {
    throw new HttpError("Odoo didn't confirm the deletion.", 502);
  }
  return { instanceIndex, timesheetId };
}
function readIdQuery(query) {
  const match = /^#?(\d{1,9})$/.exec(query);
  return match === null ? null : Number(match[1]);
}
function anyOf(leaves) {
  return [...Array(Math.max(0, leaves.length - 1)).fill("|"), ...leaves];
}
function searchAllTasks(instances, query, instanceIndex) {
  const id = readIdQuery(query);
  const matches = anyOf([
    ["name", "ilike", query],
    ["project_id", "ilike", query],
    ...id === null ? [] : [["id", "=", id]]
  ]);
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTaskFields(session);
      const records = await executeKw(
        session,
        "project.task",
        "search_read",
        [[["active", "=", true], ["project_id", "!=", false], ...matches]],
        {
          fields: support.fields,
          limit: SEARCH_LIMIT,
          order: "priority desc, id desc"
        }
      );
      const raw = readRecords(records, session, "task");
      return {
        tasks: raw.flatMap(
          (record) => readKanbanTask(record, index, support) ?? []
        ),
        truncated: raw.length >= SEARCH_LIMIT
      };
    }
  );
}
var TICKET_MODEL = "helpdesk.ticket";
var BASE_TICKET_FIELDS = ["id", "name", "stage_id", "team_id", "priority"];
var TICKET_REF_FIELDS = ["ticket_ref", "number"];
async function detectTicketFields(session) {
  let ticket;
  try {
    ticket = await getModelFields(session, TICKET_MODEL);
  } catch (error) {
    if (error instanceof OdooRpcError) {
      return null;
    }
    throw error;
  }
  const lines = await getModelFields(session, "account.analytic.line");
  const has = (field) => ticket.has(field);
  const first = (candidates) => candidates.find((field) => has(field)) ?? null;
  const refField = first(TICKET_REF_FIELDS);
  const timesheetFlag = first([
    "use_helpdesk_timesheet",
    "allow_timesheet"
  ]);
  const hoursField = first([
    "total_hours_spent",
    "effective_hours",
    "total_hours"
  ]);
  const hasTask = has("task_id");
  const optional = [
    refField,
    "project_id",
    timesheetFlag,
    hoursField,
    hasTask ? "task_id" : null
  ].filter((field) => field !== null && has(field));
  const openDomain = has("close_date") ? [["close_date", "=", false]] : has("closed") ? [["closed", "=", false]] : [["stage_id.fold", "=", false]];
  return {
    fields: [...BASE_TICKET_FIELDS.filter(has), ...optional],
    refField,
    lineLink: has("project_id") ? findTicketLinkField(lines) : null,
    timesheetFlag,
    hoursField,
    hasTask,
    openDomain
  };
}
function readTicket(record, instanceIndex, support) {
  if (!isRecord(record) || !isPositiveInteger(record.id) || typeof record.name !== "string") {
    return null;
  }
  const project = readMany2one(record.project_id);
  const priority = Number(record.priority);
  return {
    instanceIndex,
    ticketId: record.id,
    name: record.name,
    ref: support.refField !== null && typeof record[support.refField] === "string" ? record[support.refField] : null,
    stageName: readMany2one(record.stage_id)?.name ?? null,
    teamName: readMany2one(record.team_id)?.name ?? null,
    priority: Number.isInteger(priority) && priority > 0 ? priority : 0,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    hoursSpent: support.hoursField === null ? null : readNumber(record[support.hoursField]) ?? 0,
    loggable: support.lineLink !== null && project !== null && (support.timesheetFlag === null || record[support.timesheetFlag] !== false)
  };
}
function searchTickets(instances, { query, mine, instanceIndex }) {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const support = await detectTicketFields(session);
      if (support === null) {
        return { available: false, tickets: [], truncated: false };
      }
      const id = readIdQuery(query);
      const matches = query === "" ? [] : anyOf([
        ["name", "ilike", query],
        ...support.refField === null ? [] : [[support.refField, "ilike", query]],
        ...id === null ? [] : [["id", "=", id]]
      ]);
      const limit = mine ? MY_TICKETS_LIMIT : SEARCH_LIMIT;
      const records = await executeKw(
        session,
        TICKET_MODEL,
        "search_read",
        [
          [
            ...support.openDomain,
            ...mine ? [["user_id", "=", session.uid]] : [],
            ...matches
          ]
        ],
        { fields: support.fields, limit, order: "priority desc, id desc" }
      );
      const raw = readRecords(records, session, "ticket");
      return {
        available: true,
        tickets: raw.flatMap(
          (record) => readTicket(record, index, support) ?? []
        ),
        truncated: raw.length >= limit
      };
    }
  );
}
async function logTicketTime(instances, entry) {
  const session = await createSessionPool(instances)(entry.instanceIndex);
  const support = await detectTicketFields(session);
  if (support === null || support.lineLink === null) {
    throw new HttpError(
      `${session.connection.label} doesn't track time on helpdesk tickets.`,
      409
    );
  }
  const records = await executeKw(
    session,
    TICKET_MODEL,
    "read",
    [[entry.ticketId]],
    { fields: support.fields }
  );
  const ticket = readTicket(
    Array.isArray(records) ? records[0] : void 0,
    entry.instanceIndex,
    support
  );
  if (ticket === null) {
    throw new HttpError("This ticket can't be read in Odoo.", 404);
  }
  if (!ticket.loggable || ticket.projectId === null) {
    throw new HttpError(
      "Time can't be logged on this ticket: its helpdesk team has no timesheet project.",
      409
    );
  }
  const record = Array.isArray(records) ? records[0] : void 0;
  const task = support.hasTask && isRecord(record) ? readMany2one(record.task_id) : null;
  const timesheetId = await asConflict(
    executeKw(session, "account.analytic.line", "create", [
      {
        name: entry.description,
        project_id: ticket.projectId,
        [support.lineLink]: entry.ticketId,
        ...task === null ? {} : { task_id: task.id },
        unit_amount: entry.hours,
        date: entry.date
      }
    ])
  );
  if (!isPositiveInteger(timesheetId)) {
    throw new HttpError("Odoo didn't return the new timesheet id.", 502);
  }
  return { timesheetId };
}
serveJson("odoo-gateway", {
  POST: async ({ request, userId }) => {
    const gatewayRequest = parseRequest(await readJsonBody(request));
    const instances = requireOdooInstances(await loadSettings(userId));
    switch (gatewayRequest.action) {
      case "SEARCH_TASK":
        return {
          results: await searchTasks(instances, gatewayRequest.taskRefs)
        };
      case "SUBMIT_TIMESHEET":
        return {
          results: await submitTimesheets(instances, gatewayRequest.entries)
        };
      case "FIND_TIMESHEETS":
        return {
          results: await findTimesheets(instances, gatewayRequest.lookups)
        };
      case "GET_TASK":
        return { task: await getTask(instances, gatewayRequest) };
      case "GET_MY_TASKS":
        return {
          instances: await getMyTasks(instances, gatewayRequest.instanceIndex)
        };
      case "GET_TIMESHEET_HISTORY":
        return {
          instances: await getTimesheetHistory(instances, gatewayRequest)
        };
      case "UPDATE_TIMESHEET":
        return { timesheet: await updateTimesheet(instances, gatewayRequest) };
      case "DELETE_TIMESHEET":
        return { deleted: await deleteTimesheet(instances, gatewayRequest) };
      case "SEARCH_TASKS":
        return {
          instances: await searchAllTasks(
            instances,
            gatewayRequest.query,
            gatewayRequest.instanceIndex
          )
        };
      case "SEARCH_TICKETS":
        return { instances: await searchTickets(instances, gatewayRequest) };
      case "LOG_TICKET_TIME":
        return await logTicketTime(instances, gatewayRequest);
    }
  }
});
