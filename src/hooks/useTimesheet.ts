import { useCallback, useMemo, useReducer, useState } from "react"

import { fetchCommits } from "@/services/commitSourceService"
import {
  deleteTimesheet,
  findLoggedTimesheets,
  searchTasks,
  submitTimesheets,
  updateTimesheet,
} from "@/services/odooService"
import type {
  CommitPeriod,
  ImportSummary,
  OdooTaskMatch,
  ParsedCommit,
  SubmissionResult,
  SubmissionSummary,
  TaskSearchResult,
  TimesheetChanges,
  TimesheetEntry,
  TimesheetLookup,
  TimesheetSubmission,
  VerificationSummary,
} from "@/types/timesheet"
import { parseCommitLog, parseCommitMessage } from "@/utils/commitParser"
import { estimateHours, type EstimateLine } from "@/utils/hoursEstimate"
import {
  NOT_LOGGED,
  reconcileWithOdoo,
  type OdooReconciliation,
} from "@/utils/odooReconciliation"
import { getPresetPeriod, isInPeriod } from "@/utils/period"
import { describeCommit } from "@/utils/timesheetDescription"
import {
  canAssignTask,
  canVerify,
  isEditable,
  isInOdoo,
  isSubmittable,
  roundHours,
  type SubmittableEntry,
} from "@/utils/timesheetRules"

const DEFAULT_HOURS = 1

type FailedSubmission = Extract<SubmissionResult, { success: false }>

interface DatedCommit {
  commit: ParsedCommit
  date: string
  authoredAt: string | null
}

interface TaskMatch {
  entry: TimesheetEntry
  task: OdooTaskMatch | null
  /** Description to keep once verified: regenerated unless the user edited it. */
  description: string
}

type VerifiedEntry = TaskMatch & { task: OdooTaskMatch }

interface TaskResolution {
  id: string
  task: OdooTaskMatch | null
  description: string
  reconciliation: OdooReconciliation
}

type TimesheetAction =
  | { type: "entriesAdded"; entries: TimesheetEntry[] }
  | { type: "entryRemoved"; id: string }
  | { type: "periodApplied"; period: CommitPeriod }
  | { type: "descriptionChanged"; id: string; description: string }
  | { type: "hoursChanged"; id: string; hours: number }
  | { type: "verificationStarted"; ids: string[] }
  | { type: "verificationResolved"; resolutions: TaskResolution[] }
  | { type: "verificationFailed"; ids: string[]; message: string }
  /** The user picked the task of these lines by hand. */
  | { type: "taskAssigned"; ids: string[]; task: OdooTaskMatch }
  | { type: "submissionStarted"; ids: string[] }
  | { type: "submissionResolved"; ids: string[]; results: SubmissionResult[] }
  | { type: "submissionFailed"; ids: string[]; message: string }
  | {
      type: "loggedEntryUpdated"
      id: string
      hours: number
      description: string
    }
  | { type: "loggedEntryDeleted"; id: string }
  /** Spreads the workday over the lines of these days (all days when null). */
  | { type: "hoursEstimated"; dates: string[] | null }

function updateWhere(
  entries: TimesheetEntry[],
  ids: ReadonlySet<string>,
  update: (entry: TimesheetEntry) => TimesheetEntry
): TimesheetEntry[] {
  return entries.map((entry) => (ids.has(entry.id) ? update(entry) : entry))
}

/** Editing a line that failed to submit puts it back in the "found" state. */
function applyEdit(
  entry: TimesheetEntry,
  patch: Partial<
    Pick<
      TimesheetEntry,
      "description" | "isDescriptionEdited" | "hours" | "isHoursEdited"
    >
  >
): TimesheetEntry {
  if (!isEditable(entry)) {
    return entry
  }
  const recovered =
    entry.status === "error" && entry.task !== null
      ? { status: "found" as const, statusDetail: null }
      : {}
  return { ...entry, ...patch, ...recovered }
}

/**
 * Attaches a task picked by hand. The description is rebuilt with the task's
 * title unless the user typed it; the check against Odoo follows.
 */
function withManualTask(
  entry: TimesheetEntry,
  task: OdooTaskMatch
): TimesheetEntry {
  if (!canAssignTask(entry)) {
    return entry
  }
  return {
    ...entry,
    task,
    isTaskManual: true,
    status: "found",
    statusDetail: null,
    loggedHours: 0,
    description: entry.isDescriptionEdited
      ? entry.description
      : describeCommit(entry.commit, task),
  }
}

function resolveVerification(
  entry: TimesheetEntry,
  { task, description, reconciliation }: TaskResolution
): TimesheetEntry {
  const base = { ...entry, activity: "idle" as const, task, description }
  if (task === null) {
    return {
      ...base,
      status: "missing",
      statusDetail: {
        reason: "taskNotFound",
        taskRef: entry.commit.taskRef ?? "",
      },
      loggedHours: 0,
    }
  }
  const { duplicate, loggedHours } = reconciliation
  if (duplicate !== null) {
    // Mirror the existing timesheet so the hours reflect what Odoo holds.
    return {
      ...base,
      status: "logged",
      statusDetail: { reason: "alreadyLogged" },
      hours: duplicate.hours,
      odooTimesheetId: duplicate.timesheetId,
      odooLocked: duplicate.locked,
      loggedHours,
    }
  }
  return { ...base, status: "found", statusDetail: null, loggedHours }
}

function resolveSubmission(
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

/** Mirrors an edit made in Odoo on a line that is already there. */
function applyOdooUpdate(
  entry: TimesheetEntry,
  hours: number,
  description: string
): TimesheetEntry {
  // loggedHours counts the duplicate itself for lines found already logged.
  const loggedHours =
    entry.status === "logged"
      ? roundHours(Math.max(0, entry.loggedHours - entry.hours + hours))
      : entry.loggedHours
  return {
    ...entry,
    hours,
    description,
    isDescriptionEdited: true,
    loggedHours,
  }
}

/** The line left Odoo: it is back to a found line, ready to submit again. */
function applyOdooDeletion(entry: TimesheetEntry): TimesheetEntry {
  const loggedHours =
    entry.status === "logged"
      ? roundHours(Math.max(0, entry.loggedHours - entry.hours))
      : entry.loggedHours
  return {
    ...entry,
    status: "found",
    statusDetail: null,
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours,
  }
}

/**
 * How a line takes part in the estimate: fixed (in Odoo, or hours typed by
 * the user), flexible (a line to submit), or left out (no task: it won't be
 * submitted, so it shouldn't take a share of the day).
 */
function toEstimateLine(entry: TimesheetEntry): EstimateLine | null {
  if (entry.task === null) {
    return null
  }
  const isFixed = isInOdoo(entry) || entry.isHoursEdited || !isEditable(entry)
  return {
    id: entry.id,
    date: entry.date,
    authoredAt: entry.authoredAt,
    hours: entry.hours,
    isFixed,
  }
}

function applyEstimate(
  entries: TimesheetEntry[],
  dates: string[] | null
): TimesheetEntry[] {
  const wanted = dates === null ? null : new Set(dates)
  const lines = entries
    .filter((entry) => wanted === null || wanted.has(entry.date))
    .flatMap((entry) => toEstimateLine(entry) ?? [])
  const estimates = estimateHours(lines)
  return entries.map((entry) => {
    const hours = estimates.get(entry.id)
    return hours === undefined || hours === entry.hours
      ? entry
      : { ...entry, hours }
  })
}

function timesheetReducer(
  entries: TimesheetEntry[],
  action: TimesheetAction
): TimesheetEntry[] {
  switch (action.type) {
    case "entriesAdded":
      return [...entries, ...action.entries]

    case "entryRemoved":
      return entries.filter(
        (entry) => entry.id !== action.id || entry.activity !== "idle"
      )

    case "periodApplied":
      // Lines of other days leave the list; those being sent stay until done.
      return entries.filter(
        (entry) =>
          isInPeriod(entry.date, action.period) || entry.activity !== "idle"
      )

    case "descriptionChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, {
          description: action.description,
          isDescriptionEdited: true,
        })
      )

    case "hoursChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, { hours: action.hours, isHoursEdited: true })
      )

    case "verificationStarted":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "verifying",
        status: "pending",
        statusDetail: null,
      }))

    case "verificationResolved": {
      const byId = new Map(
        action.resolutions.map((resolution) => [resolution.id, resolution])
      )
      return entries.map((entry) => {
        const resolution = byId.get(entry.id)
        return resolution === undefined
          ? entry
          : resolveVerification(entry, resolution)
      })
    }

    case "verificationFailed":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "idle",
        // A task picked by hand stays: only the check against Odoo failed.
        task: entry.isTaskManual ? entry.task : null,
        status: "error",
        statusDetail: { reason: "serverError", message: action.message },
        loggedHours: 0,
      }))

    case "taskAssigned":
      return updateWhere(entries, new Set(action.ids), (entry) =>
        withManualTask(entry, action.task)
      )

    case "submissionStarted":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "submitting",
      }))

    case "submissionResolved": {
      const byClientId = new Map(
        action.results.map((result) => [result.clientId, result])
      )
      return updateWhere(entries, new Set(action.ids), (entry) =>
        resolveSubmission(entry, byClientId.get(entry.id))
      )
    }

    case "submissionFailed":
      return updateWhere(entries, new Set(action.ids), (entry) => ({
        ...entry,
        activity: "idle",
        status: "error",
        statusDetail: { reason: "serverError", message: action.message },
      }))

    case "loggedEntryUpdated":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        isInOdoo(entry)
          ? applyOdooUpdate(entry, action.hours, action.description)
          : entry
      )

    case "loggedEntryDeleted":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        isInOdoo(entry) ? applyOdooDeletion(entry) : entry
      )

    case "hoursEstimated":
      return applyEstimate(entries, action.dates)
  }
}

function createEntry({
  commit,
  date,
  authoredAt,
}: DatedCommit): TimesheetEntry {
  const hasTaskRef = commit.taskRef !== null
  return {
    id: crypto.randomUUID(),
    commit,
    description: describeCommit(commit, null),
    isDescriptionEdited: false,
    hours: DEFAULT_HOURS,
    isHoursEdited: false,
    date,
    authoredAt,
    status: hasTaskRef ? "pending" : "missing",
    task: null,
    isTaskManual: false,
    activity: "idle",
    statusDetail: hasTaskRef ? null : { reason: "noTaskReference" },
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours: 0,
  }
}

function toTaskMatch(
  result: TaskSearchResult | undefined
): OdooTaskMatch | null {
  if (result === undefined || !result.found) {
    return null
  }
  return {
    taskId: result.taskId,
    taskName: result.taskName,
    projectId: result.projectId,
    projectName: result.projectName,
    instanceIndex: result.instanceIndex,
  }
}

function toLookup({ entry, task }: VerifiedEntry): TimesheetLookup {
  return {
    instanceIndex: task.instanceIndex,
    taskId: task.taskId,
    date: entry.date,
  }
}

/** Matches found lines with the timesheets the user already has in Odoo. */
async function reconcile(
  verified: VerifiedEntry[]
): Promise<Map<string, OdooReconciliation>> {
  const timesheets = await findLoggedTimesheets(verified.map(toLookup))
  return reconcileWithOdoo(
    verified.map(({ entry, task, description }) => ({
      id: entry.id,
      description,
      date: entry.date,
      task,
    })),
    timesheets
  )
}

function toSubmission(entry: SubmittableEntry): TimesheetSubmission {
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong."
}

function entryKey(rawMessage: string, date: string): string {
  return `${date}\u0000${rawMessage}`
}

export interface UseTimesheetResult {
  entries: TimesheetEntry[]
  /** Days whose GitHub commits are imported. */
  period: CommitPeriod
  setPeriod: (period: CommitPeriod) => void
  totalHours: number
  submittableCount: number
  isImporting: boolean
  isSubmitting: boolean
  importFromText: (raw: string, date: string) => Promise<ImportSummary>
  /** Fetches the period's commits; lines of other days leave the list. */
  importFromGithub: () => Promise<ImportSummary>
  verifyEntry: (id: string) => Promise<VerificationSummary>
  /**
   * Attaches a task picked by hand to these lines, then checks Odoo for time
   * already logged on it, like a found reference.
   */
  assignTask: (
    ids: string[],
    task: OdooTaskMatch
  ) => Promise<VerificationSummary>
  updateDescription: (id: string, description: string) => void
  updateHours: (id: string, hours: number) => void
  removeEntry: (id: string) => void
  submitEntry: (id: string) => Promise<SubmissionSummary>
  submitAll: () => Promise<SubmissionSummary>
  /** Edits a line already in Odoo; rejects with Odoo's message. */
  updateInOdoo: (id: string, changes: TimesheetChanges) => Promise<void>
  /** Deletes a line from Odoo; it stays in the list, ready to submit again. */
  deleteFromOdoo: (id: string) => Promise<void>
  /** Spreads the workday over the lines to submit, by commit time. */
  estimateAllHours: () => void
  /** Lines whose hours an estimate may change. */
  estimableCount: number
}

export function useTimesheet(): UseTimesheetResult {
  const [entries, dispatch] = useReducer(timesheetReducer, [])
  const [period, setPeriod] = useState<CommitPeriod>(() =>
    getPresetPeriod("today")
  )
  const [isImporting, setIsImporting] = useState(false)

  const verify = useCallback(
    async (targets: TimesheetEntry[]): Promise<VerificationSummary> => {
      const verifiable = targets.filter(canVerify)
      const ids = verifiable.map((entry) => entry.id)
      if (ids.length === 0) {
        return {
          found: 0,
          alreadyLogged: 0,
          missing: 0,
          failed: 0,
          errorMessage: null,
        }
      }

      dispatch({ type: "verificationStarted", ids })
      try {
        // Tasks picked by hand are kept: only references are searched.
        const taskRefs = [
          ...new Set(
            verifiable.flatMap((entry) =>
              entry.isTaskManual || entry.commit.taskRef === null
                ? []
                : [entry.commit.taskRef]
            )
          ),
        ]
        const results = taskRefs.length > 0 ? await searchTasks(taskRefs) : []
        const byRef = new Map(results.map((result) => [result.taskRef, result]))
        const matches = verifiable.map((entry): TaskMatch => {
          const task =
            entry.isTaskManual && entry.task !== null
              ? entry.task
              : toTaskMatch(byRef.get(entry.commit.taskRef ?? ""))
          return {
            entry,
            task,
            description: entry.isDescriptionEdited
              ? entry.description
              : describeCommit(entry.commit, task),
          }
        })
        const verified = matches.filter(
          (match): match is VerifiedEntry => match.task !== null
        )
        const reconciliations = await reconcile(verified)
        const resolutions = matches.map(({ entry, task, description }) => ({
          id: entry.id,
          task,
          description,
          reconciliation: reconciliations.get(entry.id) ?? NOT_LOGGED,
        }))
        dispatch({ type: "verificationResolved", resolutions })

        return {
          found: verified.length,
          alreadyLogged: resolutions.filter(
            ({ reconciliation }) => reconciliation.duplicate !== null
          ).length,
          missing: resolutions.length - verified.length,
          failed: 0,
          errorMessage: null,
        }
      } catch (error) {
        const message = toErrorMessage(error)
        dispatch({ type: "verificationFailed", ids, message })
        return {
          found: 0,
          alreadyLogged: 0,
          missing: 0,
          failed: ids.length,
          errorMessage: message,
        }
      }
    },
    []
  )

  const addAndVerify = useCallback(
    async (commits: DatedCommit[]): Promise<ImportSummary> => {
      const known = new Set(
        entries.map((entry) => entryKey(entry.commit.rawMessage, entry.date))
      )
      const fresh = commits.filter(({ commit, date }) => {
        const key = entryKey(commit.rawMessage, date)
        if (known.has(key)) {
          return false
        }
        known.add(key)
        return true
      })

      const newEntries = fresh.map(createEntry)
      dispatch({ type: "entriesAdded", entries: newEntries })
      const verification = await verify(newEntries)
      // Once tasks and Odoo duplicates are known, spread the workday over
      // the days that received new lines (the user's typed hours stay).
      if (newEntries.length > 0) {
        dispatch({
          type: "hoursEstimated",
          dates: [...new Set(newEntries.map((entry) => entry.date))],
        })
      }

      return {
        added: newEntries.length,
        duplicates: commits.length - fresh.length,
        verification,
      }
    },
    [entries, verify]
  )

  const importFromText = useCallback(
    (raw: string, date: string): Promise<ImportSummary> =>
      addAndVerify(
        parseCommitLog(raw).map((commit) => ({
          commit,
          date,
          authoredAt: null,
        }))
      ),
    [addAndVerify]
  )

  const importFromGithub = useCallback(async (): Promise<ImportSummary> => {
    setIsImporting(true)
    try {
      const rawCommits = await fetchCommits(period)
      // The list now shows the fetched period. Lines already in it for these
      // days are kept with their edits; the fetched duplicates are skipped.
      dispatch({ type: "periodApplied", period })
      const dated = rawCommits.flatMap(({ message, date, authoredAt }) => {
        const commit = parseCommitMessage(message)
        return commit === null ? [] : [{ commit, date, authoredAt }]
      })
      return await addAndVerify(dated)
    } finally {
      setIsImporting(false)
    }
  }, [addAndVerify, period])

  const submit = useCallback(
    async (targets: TimesheetEntry[]): Promise<SubmissionSummary> => {
      const ready = targets.filter(isSubmittable)
      const ids = ready.map((entry) => entry.id)
      if (ids.length === 0) {
        return { submitted: 0, failed: 0, errorMessage: null }
      }

      dispatch({ type: "submissionStarted", ids })
      try {
        const results = await submitTimesheets(ready.map(toSubmission))
        dispatch({ type: "submissionResolved", ids, results })

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
      } catch (error) {
        const message = toErrorMessage(error)
        dispatch({ type: "submissionFailed", ids, message })
        return { submitted: 0, failed: ids.length, errorMessage: message }
      }
    },
    []
  )

  const verifyEntry = useCallback(
    (id: string) => verify(entries.filter((entry) => entry.id === id)),
    [entries, verify]
  )

  const assignTask = useCallback(
    async (
      ids: string[],
      task: OdooTaskMatch
    ): Promise<VerificationSummary> => {
      const wanted = new Set(ids)
      const targets = entries
        .filter((entry) => wanted.has(entry.id) && canAssignTask(entry))
        .map((entry) => withManualTask(entry, task))
      dispatch({
        type: "taskAssigned",
        ids: targets.map((entry) => entry.id),
        task,
      })
      const verification = await verify(targets)
      // The lines now take part in the workday: spread it again over their
      // days (hours the user typed stay).
      if (targets.length > 0) {
        dispatch({
          type: "hoursEstimated",
          dates: [...new Set(targets.map((entry) => entry.date))],
        })
      }
      return verification
    },
    [entries, verify]
  )

  const submitEntry = useCallback(
    (id: string) => submit(entries.filter((entry) => entry.id === id)),
    [entries, submit]
  )

  const submitAll = useCallback(() => submit(entries), [entries, submit])

  const updateDescription = useCallback((id: string, description: string) => {
    dispatch({ type: "descriptionChanged", id, description })
  }, [])

  const updateHours = useCallback((id: string, hours: number) => {
    dispatch({ type: "hoursChanged", id, hours })
  }, [])

  const removeEntry = useCallback((id: string) => {
    dispatch({ type: "entryRemoved", id })
  }, [])

  const findOdooLine = useCallback(
    (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id)
      if (
        entry === undefined ||
        !isInOdoo(entry) ||
        entry.task === null ||
        entry.odooTimesheetId === null
      ) {
        throw new Error("This line isn't in Odoo.")
      }
      return {
        instanceIndex: entry.task.instanceIndex,
        timesheetId: entry.odooTimesheetId,
      }
    },
    [entries]
  )

  const updateInOdoo = useCallback(
    async (id: string, changes: TimesheetChanges): Promise<void> => {
      const saved = await updateTimesheet(findOdooLine(id), changes)
      dispatch({
        type: "loggedEntryUpdated",
        id,
        hours: saved.hours,
        description: saved.description,
      })
    },
    [findOdooLine]
  )

  const deleteFromOdoo = useCallback(
    async (id: string): Promise<void> => {
      await deleteTimesheet(findOdooLine(id))
      dispatch({ type: "loggedEntryDeleted", id })
    },
    [findOdooLine]
  )

  const estimateAllHours = useCallback((): void => {
    dispatch({ type: "hoursEstimated", dates: null })
  }, [])

  const estimableCount = useMemo(
    () =>
      entries.filter((entry) => {
        const line = toEstimateLine(entry)
        return line !== null && !line.isFixed
      }).length,
    [entries]
  )

  const totalHours = useMemo(
    () => roundHours(entries.reduce((sum, entry) => sum + entry.hours, 0)),
    [entries]
  )

  const submittableCount = useMemo(
    () => entries.filter(isSubmittable).length,
    [entries]
  )

  const isSubmitting = entries.some((entry) => entry.activity === "submitting")

  return {
    entries,
    period,
    setPeriod,
    totalHours,
    submittableCount,
    isImporting,
    isSubmitting,
    importFromText,
    importFromGithub,
    verifyEntry,
    assignTask,
    updateDescription,
    updateHours,
    removeEntry,
    submitEntry,
    submitAll,
    updateInOdoo,
    deleteFromOdoo,
    estimateAllHours,
    estimableCount,
  }
}
