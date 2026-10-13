import { logTicketTime, logTime } from "@/services/odooService"
import type {
  HelpdeskTicket,
  KanbanTask,
  OdooInstanceIndex,
} from "@/types/timesheet"

/** What time is logged on: a project task or a helpdesk ticket. */
export interface LogTarget {
  kind: "task" | "ticket"
  instanceIndex: OdooInstanceIndex
  /** Task id or ticket id, depending on `kind`. */
  id: number
  /** Required to log time on a task; tickets use their team's project. */
  projectId: number | null
  name: string
  /** Shown before the name, e.g. a ticket reference. */
  ref: string | null
  projectName: string | null
  /** Why time can't be logged, or null when it can. */
  blockedReason: "noProject" | "noTicketTimesheet" | null
}

export function taskTarget(task: KanbanTask): LogTarget {
  return {
    kind: "task",
    instanceIndex: task.instanceIndex,
    id: task.taskId,
    projectId: task.projectId,
    name: task.name,
    ref: null,
    projectName: task.projectName,
    blockedReason: task.projectId === null ? "noProject" : null,
  }
}

export function ticketTarget(ticket: HelpdeskTicket): LogTarget {
  return {
    kind: "ticket",
    instanceIndex: ticket.instanceIndex,
    id: ticket.ticketId,
    projectId: ticket.projectId,
    name: ticket.name,
    ref: ticket.ref,
    projectName: ticket.projectName,
    blockedReason: ticket.loggable ? null : "noTicketTimesheet",
  }
}

export function targetKey(
  target: Pick<LogTarget, "kind" | "instanceIndex" | "id">
): string {
  return `${target.kind}:${target.instanceIndex}:${target.id}`
}

/** Creates the timesheet line in Odoo; resolves with its id. */
export function logOnTarget(
  target: LogTarget,
  line: { hours: number; description: string; date: string }
): Promise<number> {
  if (target.kind === "ticket") {
    return logTicketTime({
      instanceIndex: target.instanceIndex,
      ticketId: target.id,
      ...line,
    })
  }
  if (target.projectId === null) {
    return Promise.reject(
      new Error("This task has no project, so time can't be logged on it.")
    )
  }
  return logTime({
    clientId: crypto.randomUUID(),
    taskId: target.id,
    projectId: target.projectId,
    instanceIndex: target.instanceIndex,
    ...line,
  })
}
