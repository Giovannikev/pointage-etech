import type { LeaveState } from "../_shared/leaves.ts"
import type { InstanceIndex } from "../_shared/settings.ts"

/* ------------------------------------------------------------------ */
/* Contract — mirrors src/types/timesheet.ts                           */
/* ------------------------------------------------------------------ */

export interface TaskMatch {
  taskId: number
  taskName: string
  projectId: number
  projectName: string
  instanceIndex: InstanceIndex
}

export type TaskSearchResult =
  | ({ taskRef: string; found: true } & TaskMatch)
  | { taskRef: string; found: false }

export interface TimesheetSubmission {
  clientId: string
  taskId: number
  projectId: number
  hours: number
  description: string
  date: string
  instanceIndex: InstanceIndex
}

export type SubmissionResult =
  | { clientId: string; success: true; timesheetId: number }
  | { clientId: string; success: false; error: string }

export interface TimesheetLookup {
  instanceIndex: InstanceIndex
  taskId: number
  date: string
}

export interface LoggedTimesheet extends TimesheetLookup {
  timesheetId: number
  hours: number
  description: string
  /** Validated in Odoo (Timesheets app): it can't be changed anymore. */
  locked: boolean
}

export interface TaskReference {
  instanceIndex: InstanceIndex
  taskId: number
}

/** A change made from the Kanban board: a new stage, a new state, or both. */
export interface TaskUpdate extends TaskReference {
  stageId: number | null
  status: KanbanTaskStatus | null
}

export interface TaskDetails {
  taskId: number
  name: string
  /** The task description as stored by Odoo; the dashboard sanitizes it. */
  descriptionHtml: string
  projectName: string | null
  stageName: string | null
}

/** Task state, normalized across Odoo versions (kanban_state up to 16, state from 17). */
export type KanbanTaskStatus =
  | "in_progress"
  | "changes_requested"
  | "approved"
  | "done"
  | "canceled"
  | "waiting"
  | "blocked"

export interface KanbanTask {
  instanceIndex: InstanceIndex
  taskId: number
  name: string
  projectId: number | null
  projectName: string | null
  stageId: number | null
  stageName: string | null
  /** 0 is normal; 1 and more are starred. */
  priority: number
  /**
   * "YYYY-MM-DD" when the field is a date (Odoo 16 and older), or an ISO UTC
   * timestamp ("2026-10-14T21:00:00Z") when it is a datetime (Odoo 17+): the
   * browser turns it into a local day.
   */
  deadline: string | null
  status: KanbanTaskStatus | null
  /** null when the instance has no planned hours field or none are set. */
  plannedHours: number | null
  /** null when timesheets aren't installed on the instance. */
  effectiveHours: number | null
  /** res.users ids of the task's assignees; empty when nobody is assigned. */
  assigneeIds: number[]
}

export interface KanbanStage {
  instanceIndex: InstanceIndex
  stageId: number
  name: string
  sequence: number
  folded: boolean
  /** Projects using the stage. */
  projectIds: number[]
}

export interface TimesheetHistoryEntry {
  instanceIndex: InstanceIndex
  timesheetId: number
  /** YYYY-MM-DD */
  date: string
  description: string
  hours: number
  projectId: number | null
  projectName: string | null
  taskId: number | null
  taskName: string | null
  /** Set for time logged on a helpdesk ticket. */
  ticketId: number | null
  ticketName: string | null
  /** Validated in Odoo (Timesheets app): it can't be changed anymore. */
  locked: boolean
}

/** A helpdesk ticket, as listed in the Tasks page. */
export interface HelpdeskTicket {
  instanceIndex: InstanceIndex
  ticketId: number
  name: string
  /** The ticket's reference when the instance has one (e.g. "HT10605"). */
  ref: string | null
  stageName: string | null
  teamName: string | null
  priority: number
  projectId: number | null
  projectName: string | null
  /** null when the instance doesn't track time on tickets. */
  hoursSpent: number | null
  /** Time can be logged: timesheets on tickets are on and it has a project. */
  loggable: boolean
}

export interface TicketQuery {
  query: string
  /** Only the user's open tickets (the query then filters nothing server side). */
  mine: boolean
  instanceIndex: InstanceIndex | null
  /** Narrow the tickets to these projects and assignees; empty: no filter. */
  filters: RecordFilters
}

/**
 * Project and assignee filters, keyed per instance: the same id in two
 * instances is two different records. Keys are "1:12" (instance:id), and
 * "none" in assignees for the records nobody is assigned to.
 */
export interface RecordFilters {
  projects: string[]
  assignees: string[]
}

/** Any task of the instances, filtered in Odoo (All tasks page). */
export interface TaskListQuery extends RecordFilters {
  /** Name, project or "#id"; empty when the filters are enough. */
  query: string
  /** Also done and cancelled tasks, and tasks in folded stages. */
  includeClosed: boolean
  instanceIndex: InstanceIndex | null
}

/** An internal user of one instance, for the assignee filter. */
export interface OdooAssignee {
  instanceIndex: InstanceIndex
  userId: number
  name: string
}

/** A project time can be logged in, for the manual task picker. */
export interface OdooProject {
  instanceIndex: InstanceIndex
  projectId: number
  name: string
  /** The project's customer, to tell same-name projects apart. */
  partnerName: string | null
}

export interface ProjectTaskQuery {
  instanceIndex: InstanceIndex
  projectId: number
  /** Optional name or "#id" filter; empty lists the project's latest tasks. */
  query: string
}

export interface TicketTimeEntry {
  instanceIndex: InstanceIndex
  ticketId: number
  hours: number
  description: string
  date: string
}

/** One result per instance, so a failing instance doesn't hide the other one. */
export type InstanceResult<T> =
  | ({ instanceIndex: InstanceIndex; ok: true } & T)
  | { instanceIndex: InstanceIndex; ok: false; error: string }

export type MyTasksResult = InstanceResult<{
  tasks: KanbanTask[]
  stages: KanbanStage[]
  /** States a task can be set to on this instance (UPDATE_TASK). */
  statusOptions: KanbanTaskStatus[]
  /** True when the task limit was reached and older tasks were left out. */
  truncated: boolean
}>

export type AssigneesInstanceResult = InstanceResult<{
  users: OdooAssignee[]
  /** The signed-in user's id on this instance. */
  currentUserId: number
  truncated: boolean
}>

export type TaskSearchInstanceResult = InstanceResult<{
  tasks: KanbanTask[]
  truncated: boolean
}>

export type TicketsInstanceResult = InstanceResult<{
  /** False when the Helpdesk app isn't installed on the instance. */
  available: boolean
  tickets: HelpdeskTicket[]
  truncated: boolean
}>

export type TimesheetHistoryResult = InstanceResult<{
  entries: TimesheetHistoryEntry[]
  truncated: boolean
}>

export interface TimesheetReference {
  instanceIndex: InstanceIndex
  timesheetId: number
}

export interface TimesheetUpdate extends TimesheetReference {
  hours: number
  description: string
}

/** An internal note for a task's chatter, optionally approving the task. */
export interface TaskNote {
  instanceIndex: InstanceIndex
  taskId: number
  /** Plain text; its lines and indentation are kept. */
  note: string
  approve: boolean
}

export type LeaveUnit = "day" | "half_day" | "hour"

export interface LeaveType {
  instanceIndex: InstanceIndex
  leaveTypeId: number
  name: string
  /** What a request of this type counts: days, half days or hours. */
  unit: LeaveUnit
  requiresAllocation: boolean
  /** Worked time, not an absence: remote work, training (time_type "other"). */
  workedTime: boolean
  /** Days (or hours) left, pending requests deducted; null without allocation. */
  remaining: number | null
  allocated: number | null
}

/** A public holiday of the user's working schedule. */
export interface PublicHoliday {
  name: string
  /** ISO timestamps, UTC. */
  from: string
  to: string
}

export interface LeaveRequest {
  instanceIndex: InstanceIndex
  leaveId: number
  leaveTypeId: number
  leaveTypeName: string
  dateFrom: string
  dateTo: string
  /** Half-day requests: the morning or the afternoon. */
  period: "am" | "pm" | null
  /** Hour requests: the hours of the day, 9.5 for 09:30. */
  hourFrom: number | null
  hourTo: number | null
  days: number
  /** Odoo's own label, "2 days" or "3 hours". */
  duration: string | null
  description: string
  state: LeaveState
  canDelete: boolean
  canEdit: boolean
}

export interface LeaveReference {
  instanceIndex: InstanceIndex
  leaveId: number
}

export interface TimeOffRequest {
  instanceIndex: InstanceIndex
  leaveTypeId: number
  dateFrom: string
  dateTo: string
  period: "am" | "pm" | null
  hourFrom: number | null
  hourTo: number | null
  description: string
}

export interface Attendance {
  attendanceId: number
  /** ISO timestamps, UTC. */
  checkIn: string
  checkOut: string | null
  workedHours: number
}

export type TimeOffResult = InstanceResult<{
  /** False without the Time Off app, or when the user has no employee. */
  available: boolean
  leaveTypes: LeaveType[]
  requests: LeaveRequest[]
  holidays: PublicHoliday[]
  truncated: boolean
}>

export type AttendanceResult = InstanceResult<{
  /** False without the Attendances app, or when the user has no employee. */
  available: boolean
  /** Check-in of the attendance still open; null when checked out. */
  openSince: string | null
  attendances: Attendance[]
  truncated: boolean
}>

export interface HistoryQuery {
  dateFrom: string
  dateTo: string
  instanceIndex: InstanceIndex | null
}

export const KANBAN_TASK_STATUSES: readonly KanbanTaskStatus[] = [
  "in_progress",
  "changes_requested",
  "approved",
  "done",
  "canceled",
  "waiting",
  "blocked",
]

export function isKanbanTaskStatus(value: unknown): value is KanbanTaskStatus {
  return KANBAN_TASK_STATUSES.some((status) => status === value)
}
