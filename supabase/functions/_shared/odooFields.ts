import { HttpError } from "./errors.ts"
import { executeKw, OdooRpcError, type OdooSession } from "./odoo.ts"
import { isRecord } from "./validation.ts"

/* ------------------------------------------------------------------ */
/* Model fields, cached per database                                   */
/* ------------------------------------------------------------------ */

const FIELDS_CACHE_TTL_MS = 10 * 60_000
/** Survives between requests while the function instance stays warm. */
const fieldsCache = new Map<
  string,
  { fields: Set<string>; expiresAt: number }
>()

/**
 * The fields a model has on the session's database. Field lists differ
 * between Odoo versions and installed apps, and asking search_read for a
 * missing field fails, so callers check here first.
 */
export async function getModelFields(
  session: OdooSession,
  model: string
): Promise<Set<string>> {
  const { url, db } = session.connection
  const key = `${url}|${db}|${model}`
  const cached = fieldsCache.get(key)
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.fields
  }
  const description = await executeKw(session, model, "fields_get", [], {
    attributes: ["type"],
  })
  if (!isRecord(description)) {
    throw new HttpError(
      `${session.connection.label} didn't describe the ${model} fields.`,
      502
    )
  }
  const fields = new Set(Object.keys(description))
  fieldsCache.set(key, { fields, expiresAt: Date.now() + FIELDS_CACHE_TTL_MS })
  return fields
}

/**
 * Reads the fields of a model of an optional Odoo app; null when the app
 * isn't installed ("Object hr.leave doesn't exist").
 */
export async function optionalModelFields(
  session: OdooSession,
  model: string
): Promise<Set<string> | null> {
  try {
    return await getModelFields(session, model)
  } catch (error) {
    if (error instanceof OdooRpcError) {
      return null
    }
    throw error
  }
}
