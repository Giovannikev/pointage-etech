import type {
  SubmissionResult,
  SubmissionSummary,
  TimesheetEntry,
  TimesheetSubmission,
} from "@/types/timesheet"
import type { SubmittableEntry } from "@/utils/timesheetRules"

type FailedSubmission = Extract<SubmissionResult, { success: false }>

/** The line as sent to SUBMIT_TIMESHEET. */
export function toSubmission(entry: SubmittableEntry): TimesheetSubmission {
  return {
    clientId: entry.id,
    taskId: entry.task.taskId,
    projectId: entry.task.projectId,
    hours: entry.hours,
    description: entry.description.trim(),
    date: entry.date,
    instanceIndex: entry.task.instanceIndex,
  }
}

/** The line once Odoo answered for it; no answer means it is to check. */
export function resolveSubmission(
  entry: TimesheetEntry,
  result: SubmissionResult | undefined
): TimesheetEntry {
  if (result === undefined) {
    return {
      ...entry,
      activity: "idle",
      status: "error",
      statusDetail: { reason: "noOdooResult" },
    }
  }
  if (result.success) {
    return {
      ...entry,
      activity: "idle",
      status: "submitted",
      statusDetail: null,
      odooTimesheetId: result.timesheetId,
    }
  }
  return {
    ...entry,
    activity: "idle",
    status: "error",
    statusDetail: { reason: "serverError", message: result.error },
  }
}

/** Counts the lines `ids` sent and Odoo created, with the first error. */
export function summarizeSubmission(
  ids: string[],
  results: SubmissionResult[]
): SubmissionSummary {
  const submitted = results.filter(
    (result) => result.success && ids.includes(result.clientId)
  ).length
  const failure = results.find(
    (result): result is FailedSubmission => !result.success
  )
  return {
    submitted,
    failed: ids.length - submitted,
    errorMessage: failure?.error ?? null,
  }
}
