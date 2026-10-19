import type {
  HelpdeskTicket,
  LoggedTimesheet,
  OdooTaskMatch,
  TicketLink,
} from "@/types/timesheet"

/** A line target that is a helpdesk ticket. */
export type TicketMatch = OdooTaskMatch & { ticket: TicketLink }

export function isTicketMatch(task: OdooTaskMatch): task is TicketMatch {
  return task.ticket !== undefined
}

/**
 * The line target of a ticket, or null when time can't be logged on it
 * (no timesheets on tickets, or no project for its helpdesk team).
 */
export function toTicketMatch(ticket: HelpdeskTicket): TicketMatch | null {
  if (!ticket.loggable || ticket.projectId === null) {
    return null
  }
  return {
    taskId: 0,
    taskName: ticket.name,
    projectId: ticket.projectId,
    projectName: ticket.projectName ?? ticket.teamName ?? "",
    instanceIndex: ticket.instanceIndex,
    ticket: { ticketId: ticket.ticketId, ref: ticket.ref },
  }
}

/** Unique across tasks, tickets and instances. */
export function matchKey(task: OdooTaskMatch): string {
  return isTicketMatch(task)
    ? `ticket:${task.instanceIndex}:${task.ticket.ticketId}`
    : `task:${task.instanceIndex}:${task.taskId}`
}

export function isSameMatch(a: OdooTaskMatch, b: OdooTaskMatch): boolean {
  return matchKey(a) === matchKey(b)
}

/** Same key as matchKey() for the task or ticket a timesheet is logged on. */
export function loggedTimesheetKey(timesheet: LoggedTimesheet): string {
  return timesheet.ticketId === undefined
    ? `task:${timesheet.instanceIndex}:${timesheet.taskId}`
    : `ticket:${timesheet.instanceIndex}:${timesheet.ticketId}`
}

/** "HT10605", or "#42" for an instance without ticket references. */
export function ticketLabel(ticket: TicketLink): string {
  return ticket.ref ?? `#${ticket.ticketId}`
}
