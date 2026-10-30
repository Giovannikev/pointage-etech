import {
  callWebRoute,
  closeWebSession,
  executeKw,
  OdooRpcError,
  type OdooSession,
  openWebSession,
  readMany2one,
} from "./odoo.ts"
import { isPositiveInteger, isRecord } from "./validation.ts"

/** The signed-in user's employee on this instance; null without one. */
export async function readOwnEmployeeId(
  session: OdooSession
): Promise<number | null> {
  const records = await executeKw(
    session,
    "res.users",
    "read",
    [[session.uid]],
    { fields: ["employee_id"] }
  )
  const record = Array.isArray(records) ? records[0] : undefined
  return isRecord(record)
    ? (readMany2one(record.employee_id)?.id ?? null)
    : null
}

/**
 * True when the user's access rights allow `operation` on the model:
 * has_access from Odoo 18, check_access_rights before.
 */
export async function hasModelAccess(
  session: OdooSession,
  model: string,
  operation: "create" | "write"
): Promise<boolean> {
  try {
    return (
      (await executeKw(session, model, "has_access", [[], operation])) === true
    )
  } catch (error) {
    if (!(error instanceof OdooRpcError)) throw error
  }
  try {
    return (
      (await executeKw(session, model, "check_access_rights", [operation], {
        raise_exception: false,
      })) === true
    )
  } catch (error) {
    if (error instanceof OdooRpcError) return false
    throw error
  }
}

/** Current UTC time as an Odoo datetime, "YYYY-MM-DD HH:MM:SS". */
export function odooNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

/** The id of the employee's attendance still open (checked in, not out). */
export async function readOpenAttendanceId(
  session: OdooSession,
  employeeId: number
): Promise<number | null> {
  const records = await executeKw(
    session,
    "hr.attendance",
    "search_read",
    [
      [
        ["employee_id", "=", employeeId],
        ["check_out", "=", false],
      ],
    ],
    { fields: ["id"], limit: 1, order: "check_in desc" }
  )
  const record = Array.isArray(records) ? records[0] : undefined
  return isRecord(record) && isPositiveInteger(record.id) ? record.id : null
}

/**
 * Checks the employee in, or out when an attendance is open. With the right
 * to create and edit attendances, through the API; otherwise like Odoo's own
 * attendance button, whose route runs with more rights: it needs a web
 * session, which Odoo opens with the user's password only.
 */
export async function toggleAttendance(
  session: OdooSession,
  employeeId: number
): Promise<void> {
  const [canCreate, canWrite] = await Promise.all([
    hasModelAccess(session, "hr.attendance", "create"),
    hasModelAccess(session, "hr.attendance", "write"),
  ])
  if (!canCreate || !canWrite) {
    const webSession = await openWebSession(session.connection)
    try {
      await callWebRoute(
        session.connection,
        webSession,
        "/hr_attendance/systray_check_in_out"
      )
    } finally {
      await closeWebSession(session.connection, webSession)
    }
    return
  }

  const openId = await readOpenAttendanceId(session, employeeId)
  if (openId === null) {
    await executeKw(session, "hr.attendance", "create", [
      { employee_id: employeeId, check_in: odooNow() },
    ])
    return
  }
  await executeKw(session, "hr.attendance", "write", [
    [openId],
    { check_out: odooNow() },
  ])
}
