import { HttpError } from "../_shared/errors.ts"
import {
  createSessionPool,
  OdooRpcError,
  type OdooSession,
} from "../_shared/odoo.ts"
import {
  INSTANCE_INDEXES,
  type InstanceIndex,
  type OdooInstanceSettings,
} from "../_shared/settings.ts"
import type { InstanceResult } from "./contract.ts"

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const MS_PER_DAY = 86_400_000
/** Results of a search by text (SEARCH_TASKS, SEARCH_TICKETS). */
export const SEARCH_LIMIT = 50

/* ------------------------------------------------------------------ */
/* Shared helpers for the multi-instance read actions                  */
/* ------------------------------------------------------------------ */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The requested instance, or every configured one in index order. */
export function selectInstances(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): InstanceIndex[] {
  const configured = INSTANCE_INDEXES.filter((index) =>
    instances.some((instance) => instance.index === index)
  )
  if (instanceIndex === null) {
    return configured
  }
  if (!configured.includes(instanceIndex)) {
    throw new HttpError(
      `Odoo instance ${instanceIndex} is not configured.`,
      400
    )
  }
  return [instanceIndex]
}

/**
 * Runs `read` on each instance in parallel. Odoo and network errors become a
 * per-instance error; unexpected errors still fail the whole request.
 */
export function readEachInstance<T>(
  instances: OdooInstanceSettings[],
  indexes: InstanceIndex[],
  read: (session: OdooSession, index: InstanceIndex) => Promise<T>
): Promise<InstanceResult<T>[]> {
  const getSession = createSessionPool(instances)
  return Promise.all(
    indexes.map(async (index): Promise<InstanceResult<T>> => {
      try {
        const data = await read(await getSession(index), index)
        return { instanceIndex: index, ok: true, ...data }
      } catch (error) {
        if (error instanceof HttpError) {
          return {
            instanceIndex: index,
            ok: false,
            error: errorMessage(error),
          }
        }
        throw error
      }
    })
  )
}

export function readRecords(
  value: unknown,
  session: OdooSession,
  what: string
): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(
      `${session.connection.label} returned an invalid ${what} list.`,
      502
    )
  }
  return value
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Odoo dates and datetimes ("2026-10-13" or "2026-10-13 08:00:00") as YYYY-MM-DD. */
export function readDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value.slice(0, 10))
    ? value.slice(0, 10)
    : null
}

/** Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS"; dates stay "YYYY-MM-DD". */
export function readDeadline(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(value)
  if (match === null) {
    return null
  }
  return match[2] === undefined ? match[1] : `${match[1]}T${match[2]}Z`
}

/** Odoo refusals (validated timesheet, locked period...) are conflicts, not gateway failures. */
export async function asConflict<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } catch (error) {
    if (error instanceof OdooRpcError) {
      throw new HttpError(error.message, 409)
    }
    throw error
  }
}

/** "18486" or "#18486" as a record id; null for any other text. */
export function readIdQuery(query: string): number | null {
  const match = /^#?(\d{1,9})$/.exec(query)
  return match === null ? null : Number(match[1])
}

/** OR of the leaves, in Odoo's prefix notation. */
export function anyOf(leaves: unknown[]): unknown[] {
  return [...Array(Math.max(0, leaves.length - 1)).fill("|"), ...leaves]
}
