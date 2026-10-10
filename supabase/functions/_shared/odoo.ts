import { HttpError } from "./errors.ts"
import type { InstanceIndex, OdooInstanceSettings } from "./settings.ts"
import { isPositiveInteger, isRecord } from "./validation.ts"

const RPC_TIMEOUT_MS = 20_000

/** Error raised by Odoo itself (access rights, validation...). */
export class OdooRpcError extends HttpError {
  constructor(message: string) {
    super(message, 502)
    this.name = "OdooRpcError"
  }
}

export interface OdooConnection {
  label: string
  url: string
  db: string
  login: string
  apiKey: string
}

export interface OdooSession {
  connection: OdooConnection
  uid: number
}

let rpcRequestId = 0

function readOdooErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    if (isRecord(error.data) && typeof error.data.message === "string") {
      return error.data.message
    }
    if (typeof error.message === "string") {
      return error.message
    }
  }
  return "Odoo returned an unknown error."
}

async function postJsonRpc(
  url: string,
  label: string,
  params: Record<string, unknown>
): Promise<unknown> {
  rpcRequestId += 1

  let response: Response
  try {
    response = await fetch(url, {
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
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new HttpError(`${label} is unreachable (${reason}).`, 502)
  }

  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get("Location") ?? "another address"
    throw new HttpError(
      `${label} redirects to ${target}. Use that URL in Settings.`,
      502
    )
  }
  if (!response.ok) {
    throw new HttpError(`${label} responded with HTTP ${response.status}.`, 502)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!isRecord(payload)) {
    throw new HttpError(`${label} returned an invalid JSON-RPC payload.`, 502)
  }
  if (payload.error !== undefined) {
    throw new OdooRpcError(readOdooErrorMessage(payload.error))
  }
  return payload.result
}

function callService(
  connection: OdooConnection,
  service: "common" | "object",
  method: string,
  args: unknown[]
): Promise<unknown> {
  return postJsonRpc(`${connection.url}/jsonrpc`, connection.label, {
    service,
    method,
    args,
  })
}

/** Finds the database name when the server hosts a single one. */
export async function detectDatabase(
  url: string,
  label: string
): Promise<string> {
  try {
    const databases = await postJsonRpc(`${url}/web/database/list`, label, {})
    if (
      Array.isArray(databases) &&
      databases.length === 1 &&
      typeof databases[0] === "string"
    ) {
      return databases[0]
    }
  } catch (error) {
    // Odoo refuses to list databases when list_db is disabled.
    if (!(error instanceof OdooRpcError)) {
      throw error
    }
  }
  throw new HttpError(
    `Couldn't detect the database of ${label}. Enter its name in Settings.`,
    400
  )
}

export async function authenticate(
  connection: OdooConnection
): Promise<OdooSession> {
  let uid: unknown
  try {
    uid = await callService(connection, "common", "authenticate", [
      connection.db,
      connection.login,
      connection.apiKey,
      {},
    ])
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new OdooRpcError(
        `Authentication failed on ${connection.label}: ${error.message}`
      )
    }
    throw error
  }

  if (!isPositiveInteger(uid)) {
    throw new OdooRpcError(
      `Authentication failed on ${connection.label}. Check the database, login and API key.`
    )
  }
  return { connection, uid }
}

export function executeKw(
  session: OdooSession,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  const { connection, uid } = session
  return callService(connection, "object", "execute_kw", [
    connection.db,
    uid,
    connection.apiKey,
    model,
    method,
    args,
    kwargs,
  ])
}

/** Authenticates at most once per instance during a request. */
export function createSessionPool(
  instances: OdooInstanceSettings[]
): (index: InstanceIndex) => Promise<OdooSession> {
  const sessions = new Map<InstanceIndex, Promise<OdooSession>>()
  return (index) => {
    let session = sessions.get(index)
    if (session === undefined) {
      const instance = instances.find((candidate) => candidate.index === index)
      session =
        instance === undefined
          ? Promise.reject(
              new HttpError(`Odoo instance ${index} is not configured.`, 400)
            )
          : authenticate(instance)
      sessions.set(index, session)
    }
    return session
  }
}

/** Odoo many2one values are serialized as [id, display_name] or false. */
export function readMany2one(
  value: unknown
): { id: number; name: string } | null {
  if (
    Array.isArray(value) &&
    isPositiveInteger(value[0]) &&
    typeof value[1] === "string"
  ) {
    return { id: value[0], name: value[1] }
  }
  return null
}
