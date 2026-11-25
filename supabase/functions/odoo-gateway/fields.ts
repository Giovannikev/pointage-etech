import type { OdooSession } from "../_shared/odoo.ts"
import { getModelFields } from "../_shared/odooFields.ts"

/* ------------------------------------------------------------------ */
/* Field detection shared by timesheets and tickets                    */
/* ------------------------------------------------------------------ */

/**
 * Field linking a timesheet line to its helpdesk ticket: Odoo Enterprise's
 * Helpdesk, or OCA's helpdesk_mgmt_timesheet.
 */
const TICKET_LINK_FIELDS = ["helpdesk_ticket_id", "ticket_id"] as const
export type TicketLinkField = (typeof TICKET_LINK_FIELDS)[number]

export function findTicketLinkField(
  lineFields: Set<string>
): TicketLinkField | null {
  return TICKET_LINK_FIELDS.find((field) => lineFields.has(field)) ?? null
}

/**
 * The timesheet fields to read, plus "validated" (Timesheets app) and the
 * ticket link (Helpdesk timesheets) when the instance has them.
 */
export async function timesheetFields(
  session: OdooSession,
  base: readonly string[]
): Promise<string[]> {
  const fields = await getModelFields(session, "account.analytic.line")
  const ticketLink = findTicketLinkField(fields)
  return [
    ...base,
    ...(fields.has("validated") ? ["validated"] : []),
    ...(ticketLink === null ? [] : [ticketLink]),
  ]
}
