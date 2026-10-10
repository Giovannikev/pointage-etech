/** Index of the Odoo instance a task lives in. */
export type OdooInstanceIndex = 1 | 2

/** Normalized verb extracted from a commit message. */
export type CommitAction = "add" | "fix" | "update" | "refactor" | "remove"

/** A commit as delivered by a commit source, before parsing. */
export interface RawCommit {
  message: string
  /** Local ISO date (YYYY-MM-DD) the commit was authored on. */
  date: string
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
  /** French description ready to be logged in Odoo. */
  formattedDescription: string
}

/** An Odoo task matched from a task reference. */
export interface OdooTaskMatch {
  taskId: number
  taskName: string
  projectId: number
  projectName: string
  instanceIndex: OdooInstanceIndex
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
  hours: number
  /** ISO date (YYYY-MM-DD) the timesheet is logged on. */
  date: string
  status: TimesheetStatus
  task: OdooTaskMatch | null
  activity: EntryActivity
  /** Why the line has its status, for the missing, logged and error statuses. */
  statusDetail: StatusDetail | null
  odooTimesheetId: number | null
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
  timesheetId: number
  hours: number
  description: string
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

export type GatewayRequest =
  | SearchTaskRequest
  | SubmitTimesheetRequest
  | FindTimesheetsRequest
  | GetTaskRequest

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
