/** Index of the Odoo instance a task lives in. */
export type OdooInstanceIndex = 1 | 2

/** Normalized verb extracted from a commit message. */
export type CommitAction = "add" | "fix" | "update" | "refactor" | "remove"

/** A commit as delivered by a commit source, before parsing. */
export interface RawCommit {
  message: string
  /** Local ISO date (YYYY-MM-DD) the commit was authored on. */
  date: string
  /** ISO timestamp of the commit; null when unknown (pasted commits). */
  authoredAt: string | null
}

/** Days whose commits are imported, both included. */
export interface CommitPeriod {
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD */
  to: string
}

/** Result of parsing a single Git commit message. */
export interface ParsedCommit {
  rawMessage: string
  taskRef: string | null
  moduleName: string | null
  action: CommitAction | null
  rawDescription: string
  /** French action and object, e.g. "Ajout de la fonction export"; empty when the message has neither. */
  frenchSummary: string
}

/** The helpdesk ticket a line logs time on, instead of a project task. */
export interface TicketLink {
  ticketId: number
  /** The ticket's reference when the instance has one (e.g. "HT10605"). */
  ref: string | null
}

/**
 * What a timesheet line is logged on: an Odoo task matched from a task
 * reference or picked by hand, or a helpdesk ticket picked by hand.
 */
export interface OdooTaskMatch {
  /** 0 for a ticket: a ticket line isn't logged on a task. */
  taskId: number
  /** The task's name, or the ticket's title. */
  taskName: string
  /** For a ticket: the project its helpdesk team logs time in. */
  projectId: number
  projectName: string
  instanceIndex: OdooInstanceIndex
  /** Set when the line logs time on a helpdesk ticket (LOG_TICKET_TIME). */
  ticket?: TicketLink
}

export type TimesheetStatus =
  | "pending"
  | "found"
  | "missing"
  /** An identical timesheet already exists in Odoo. */
  | "logged"
  | "submitted"
  | "error"

/** Asynchronous work currently running on an entry. */
export type EntryActivity = "idle" | "verifying" | "submitting"

/** A timesheet line being prepared in the dashboard. */
/** Reason behind a status; the interface turns it into a translated sentence. */
export type StatusDetail =
  | { reason: "noTaskReference" }
  | { reason: "taskNotFound"; taskRef: string }
  | { reason: "alreadyLogged" }
  | { reason: "noOdooResult" }
  /** Message from Odoo or the network, shown as is. */
  | { reason: "serverError"; message: string }

export interface TimesheetEntry {
  id: string
  commit: ParsedCommit
  description: string
  /** True once the user typed the description: it is no longer regenerated. */
  isDescriptionEdited: boolean
  hours: number
  /** True once the user typed the hours: estimates leave them alone. */
  isHoursEdited: boolean
  /** ISO date (YYYY-MM-DD) the timesheet is logged on. */
  date: string
  /** ISO timestamp of the commit; null for pasted commits. */
  authoredAt: string | null
  status: TimesheetStatus
  task: OdooTaskMatch | null
  /**
   * True once the user picked the task by hand (instance, project, task):
   * checking the line again keeps it instead of searching the reference.
   */
  isTaskManual: boolean
  activity: EntryActivity
  /** Why the line has its status, for the missing, logged and error statuses. */
  statusDetail: StatusDetail | null
  odooTimesheetId: number | null
  /** The Odoo line is validated: it can't be edited or deleted anymore. */
  odooLocked: boolean
  /** Hours the user had already logged in Odoo on this task and date. */
  loggedHours: number
}

/* ------------------------------------------------------------------ */
/* odoo-gateway Edge Function contract                                 */
/* Mirrored in supabase/functions/odoo-gateway/index.ts                */
/* ------------------------------------------------------------------ */

export interface SearchTaskRequest {
  action: "SEARCH_TASK"
  taskRefs: string[]
}

export type TaskSearchResult =
  | ({ taskRef: string; found: true } & OdooTaskMatch)
  | { taskRef: string; found: false }

export interface SearchTaskResponse {
  results: TaskSearchResult[]
}

export interface TimesheetSubmission {
  clientId: string
  taskId: number
  projectId: number
  hours: number
  description: string
  date: string
  instanceIndex: OdooInstanceIndex
}

export interface SubmitTimesheetRequest {
  action: "SUBMIT_TIMESHEET"
  entries: TimesheetSubmission[]
}

export type SubmissionResult =
  | { clientId: string; success: true; timesheetId: number }
  | { clientId: string; success: false; error: string }

export interface SubmitTimesheetResponse {
  results: SubmissionResult[]
}

/** A task and day whose existing timesheets are looked up. */
export interface TimesheetLookup {
  instanceIndex: OdooInstanceIndex
  taskId: number
  date: string
}

export interface FindTimesheetsRequest {
  action: "FIND_TIMESHEETS"
  lookups: TimesheetLookup[]
}

/** A timesheet the signed-in user already logged in Odoo. */
export interface LoggedTimesheet extends TimesheetLookup {
  /** Set for a line logged on a helpdesk ticket; taskId is then 0. */
  ticketId?: number
  timesheetId: number
  hours: number
  description: string
  /** Validated in Odoo (Timesheets app): it can't be changed anymore. */
  locked: boolean
}

export interface GetTaskRequest {
  action: "GET_TASK"
  instanceIndex: OdooInstanceIndex
  taskId: number
}

/** A task as shown in its details dialog. */
export interface TaskDetails {
  taskId: number
  name: string
  /** The task description as stored by Odoo, unsanitized. */
  descriptionHtml: string
  projectName: string | null
  stageName: string | null
}

/* ---- Kanban ------------------------------------------------------ */

/** Task state, normalized across Odoo versions (kanban_state up to 16, state from 17). */
export type KanbanTaskStatus =
  | "in_progress"
  | "changes_requested"
  | "approved"
  | "done"
  | "canceled"
  | "waiting"
  | "blocked"

/** An Odoo task as shown on the boards (My tasks, All tasks). */
export interface KanbanTask {
  instanceIndex: OdooInstanceIndex
  taskId: number
  name: string
  projectId: number | null
  projectName: string | null
  stageId: number | null
  stageName: string | null
  /** 0 is normal; 1 and more are starred. */
  priority: number
  /**
   * "YYYY-MM-DD" (date field, Odoo 16 and older) or an ISO UTC timestamp
   * (datetime field, Odoo 17+). Read it with toLocalIsoDate().
   */
  deadline: string | null
  status: KanbanTaskStatus | null
  /** null when the instance has no planned hours field or none are set. */
  plannedHours: number | null
  /** null when timesheets aren't installed on the instance. */
  effectiveHours: number | null
  /** res.users ids of the assignees; empty when nobody (or an older gateway). */
  assigneeIds: number[]
}

/** A project.task.type record of one instance. */
export interface KanbanStage {
  instanceIndex: OdooInstanceIndex
  stageId: number
  name: string
  sequence: number
  folded: boolean
  /** Projects using the stage; empty when Odoo didn't say. */
  projectIds: number[]
}

export interface GetMyTasksRequest {
  action: "GET_MY_TASKS"
  /** Omitted: every configured instance. */
  instanceIndex?: OdooInstanceIndex
}

/** One result per instance, so a failing instance doesn't hide the other one. */
export type InstanceResult<T> =
  | ({ instanceIndex: OdooInstanceIndex; ok: true } & T)
  | { instanceIndex: OdooInstanceIndex; ok: false; error: string }

export type MyTasksInstanceResult = InstanceResult<{
  tasks: KanbanTask[]
  stages: KanbanStage[]
  /**
   * States a task can be set to on this instance: they differ between Odoo
   * versions. Empty when the instance (or an older gateway) has none.
   */
  statusOptions: KanbanTaskStatus[]
  /** True when the task limit was reached and older tasks were left out. */
  truncated: boolean
}>

export interface GetMyTasksResponse {
  instances: MyTasksInstanceResult[]
}

/* ---- History ----------------------------------------------------- */

/** A timesheet line the signed-in user logged in Odoo. */
export interface TimesheetHistoryEntry {
  instanceIndex: OdooInstanceIndex
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

export interface GetTimesheetHistoryRequest {
  action: "GET_TIMESHEET_HISTORY"
  /** YYYY-MM-DD, included */
  dateFrom: string
  /** YYYY-MM-DD, included */
  dateTo: string
  /** Omitted: every configured instance. */
  instanceIndex?: OdooInstanceIndex
}

export type TimesheetHistoryInstanceResult = InstanceResult<{
  entries: TimesheetHistoryEntry[]
  truncated: boolean
}>

export interface GetTimesheetHistoryResponse {
  instances: TimesheetHistoryInstanceResult[]
}

/* ---- Update / delete --------------------------------------------- */

/** Identifies an existing timesheet line in one of the user's instances. */
export interface TimesheetReference {
  instanceIndex: OdooInstanceIndex
  timesheetId: number
}

export interface TimesheetChanges {
  hours: number
  description: string
}

export interface UpdateTimesheetRequest
  extends TimesheetReference, TimesheetChanges {
  action: "UPDATE_TIMESHEET"
}

export interface UpdateTimesheetResponse {
  /** The line as stored by Odoo after the update. */
  timesheet: TimesheetHistoryEntry
}

export interface DeleteTimesheetRequest extends TimesheetReference {
  action: "DELETE_TIMESHEET"
}

export interface DeleteTimesheetResponse {
  deleted: TimesheetReference
}

/* ---- Task and ticket search ------------------------------------- */

export interface SearchTasksRequest {
  action: "SEARCH_TASKS"
  /** 2 to 100 characters: name, project, or "#id". */
  query: string
  instanceIndex?: OdooInstanceIndex
}

export type TaskSearchInstanceResult = InstanceResult<{
  tasks: KanbanTask[]
  truncated: boolean
}>

/** A helpdesk ticket (Odoo Helpdesk app). */
export interface HelpdeskTicket {
  instanceIndex: OdooInstanceIndex
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

/**
 * Project and assignee filters, keyed per instance ("1:12"): the same id in
 * two instances is two different records. "none" in assignees selects the
 * records nobody is assigned to. Empty lists filter nothing.
 */
export interface RecordFilters {
  projects: string[]
  assignees: string[]
}

export interface SearchTicketsRequest extends Partial<RecordFilters> {
  action: "SEARCH_TICKETS"
  /** Optional with `mine` or a filter, otherwise 2 to 100 characters. */
  query: string
  /** Only the user's open tickets. */
  mine: boolean
  instanceIndex?: OdooInstanceIndex
}

export type TicketsInstanceResult = InstanceResult<{
  /** False when the Helpdesk app isn't installed on the instance. */
  available: boolean
  tickets: HelpdeskTicket[]
  truncated: boolean
}>

export interface LogTicketTimeRequest {
  action: "LOG_TICKET_TIME"
  instanceIndex: OdooInstanceIndex
  ticketId: number
  hours: number
  description: string
  /** YYYY-MM-DD */
  date: string
}

/* ---- All tasks page ---------------------------------------------- */

/** Any task, assigned to anyone; needs a query, a project or an assignee. */
export interface ListTasksRequest extends RecordFilters {
  action: "LIST_TASKS"
  /** Empty, or 2 to 100 characters: name, project, or "#id". */
  query: string
  /** Also done and cancelled tasks, and tasks in folded stages. */
  includeClosed: boolean
  instanceIndex?: OdooInstanceIndex
}

/** An internal user of one instance, for the assignee filter. */
export interface OdooAssignee {
  instanceIndex: OdooInstanceIndex
  userId: number
  name: string
}

export interface ListAssigneesRequest {
  action: "LIST_ASSIGNEES"
  instanceIndex?: OdooInstanceIndex
}

export type AssigneesInstanceResult = InstanceResult<{
  users: OdooAssignee[]
  /** The signed-in user's id on this instance. */
  currentUserId: number
  truncated: boolean
}>

/* ---- Manual task picker ---------------------------------------- */

/** A project of one instance that time can be logged in. */
export interface OdooProject {
  instanceIndex: OdooInstanceIndex
  projectId: number
  name: string
  /** The project's customer, to tell same-name projects apart. */
  partnerName: string | null
}

export interface ListProjectsRequest {
  action: "LIST_PROJECTS"
  instanceIndex: OdooInstanceIndex
}

export interface ListProjectsResponse {
  projects: OdooProject[]
  /** True when the project limit was reached. */
  truncated: boolean
}

export interface ListProjectTasksRequest {
  action: "LIST_PROJECT_TASKS"
  instanceIndex: OdooInstanceIndex
  projectId: number
  /** Optional name or "#id" filter, 2 to 100 characters when given. */
  query?: string
}

export interface ListProjectTasksResponse {
  tasks: KanbanTask[]
  /** True when the task limit was reached: a search narrows the list. */
  truncated: boolean
}

/* ---- Kanban edits ------------------------------------------------ */

/** Moves a task to another stage of its project and/or sets its state. */
export interface UpdateTaskRequest {
  action: "UPDATE_TASK"
  instanceIndex: OdooInstanceIndex
  taskId: number
  stageId?: number
  status?: KanbanTaskStatus
}

export interface UpdateTaskResponse {
  /** The task as Odoo holds it after the change. */
  task: KanbanTask
}

export interface PostTaskNoteRequest {
  action: "POST_TASK_NOTE"
  instanceIndex: OdooInstanceIndex
  taskId: number
  /** Plain text, posted as an internal note in the task's chatter. */
  note: string
  /** Also sets the task to approved, once the note is posted. */
  approve: boolean
}

/* Time off (Odoo Time Off app) and attendance (Odoo Attendances app) */

export type LeaveState =
  "confirm" | "refuse" | "validate1" | "validate" | "cancel"
export type LeaveUnit = "day" | "half_day" | "hour"
export type HalfDayPeriod = "am" | "pm"

export interface LeaveType {
  instanceIndex: OdooInstanceIndex
  leaveTypeId: number
  name: string
  /** What a request of this type counts: days, half days or hours. */
  unit: LeaveUnit
  requiresAllocation: boolean
  /** Days (or hours) left, pending requests deducted; null without allocation. */
  remaining: number | null
  allocated: number | null
}

export interface LeaveRequest {
  instanceIndex: OdooInstanceIndex
  leaveId: number
  leaveTypeId: number
  leaveTypeName: string
  dateFrom: string
  dateTo: string
  /** Half-day requests: the morning or the afternoon. */
  period: HalfDayPeriod | null
  /** Hour requests: hours of the day, 9.5 for 09:30. */
  hourFrom: number | null
  hourTo: number | null
  days: number
  /** Odoo's own label, "2 jours" or "3 heures". */
  duration: string | null
  description: string
  state: LeaveState
  /** Waiting for approval and not started yet. */
  canDelete: boolean
}

export interface LeaveReference {
  instanceIndex: OdooInstanceIndex
  leaveId: number
}

export interface TimeOffSubmission {
  instanceIndex: OdooInstanceIndex
  leaveTypeId: number
  dateFrom: string
  dateTo: string
  period: HalfDayPeriod | null
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

export type TimeOffInstanceResult = InstanceResult<{
  /** False without the Time Off app, or when the user has no employee. */
  available: boolean
  leaveTypes: LeaveType[]
  requests: LeaveRequest[]
  truncated: boolean
}>

export type AttendanceInstanceResult = InstanceResult<{
  /** False without the Attendances app, or when the user has no employee. */
  available: boolean
  /** Check-in of the attendance still open; null when checked out. */
  openSince: string | null
  attendances: Attendance[]
  truncated: boolean
}>

export interface GetTimeOffRequest {
  action: "GET_TIME_OFF"
  instanceIndex?: OdooInstanceIndex
}

export type RequestTimeOffRequest = {
  action: "REQUEST_TIME_OFF"
} & TimeOffSubmission

export type DeleteTimeOffRequest = {
  action: "DELETE_TIME_OFF"
} & LeaveReference

export interface GetAttendanceRequest {
  action: "GET_ATTENDANCE"
  dateFrom: string
  dateTo: string
  instanceIndex?: OdooInstanceIndex
}

export interface CheckInOutRequest {
  action: "CHECK_IN_OUT"
  instanceIndex: OdooInstanceIndex
}

export interface PostTaskNoteResponse {
  messageId: number
  /** The task as Odoo holds it after the note. */
  task: KanbanTask
}

export type GatewayRequest =
  | SearchTaskRequest
  | SubmitTimesheetRequest
  | FindTimesheetsRequest
  | GetTaskRequest
  | GetMyTasksRequest
  | GetTimesheetHistoryRequest
  | UpdateTimesheetRequest
  | DeleteTimesheetRequest
  | SearchTasksRequest
  | SearchTicketsRequest
  | LogTicketTimeRequest
  | ListProjectsRequest
  | ListProjectTasksRequest
  | UpdateTaskRequest
  | PostTaskNoteRequest
  | GetTimeOffRequest
  | RequestTimeOffRequest
  | DeleteTimeOffRequest
  | GetAttendanceRequest
  | CheckInOutRequest
  | ListTasksRequest
  | ListAssigneesRequest

/* ------------------------------------------------------------------ */
/* github-commits Edge Function contract                               */
/* Mirrored in supabase/functions/github-commits/index.ts              */
/* ------------------------------------------------------------------ */

export interface FetchCommitsRequest {
  /** ISO timestamp of the start of the period. */
  since: string
  /** ISO timestamp of the end of the period. */
  until: string
}

export interface GithubCommit {
  message: string
  /** ISO timestamp of the author date. */
  authoredAt: string
}

/* ------------------------------------------------------------------ */
/* Operation summaries returned by useTimesheet                        */
/* ------------------------------------------------------------------ */

export interface VerificationSummary {
  found: number
  /** Found lines that already exist in Odoo with the same description. */
  alreadyLogged: number
  missing: number
  failed: number
  errorMessage: string | null
}

export interface ImportSummary {
  added: number
  duplicates: number
  verification: VerificationSummary
}

export interface SubmissionSummary {
  submitted: number
  failed: number
  /** First error message, used for user feedback. */
  errorMessage: string | null
}
