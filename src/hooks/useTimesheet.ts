import { useCallback, useMemo, useReducer, useState } from "react"

import { fetchCommits } from "@/services/commitSourceService"
import {
  findLoggedTimesheets,
  searchTasks,
  submitTimesheets,
} from "@/services/odooService"
import type {
  CommitPeriod,
  ImportSummary,
  OdooTaskMatch,
  ParsedCommit,
  SubmissionResult,
  SubmissionSummary,
  TaskSearchResult,
  TimesheetEntry,
  TimesheetLookup,
  TimesheetSubmission,
  VerificationSummary,
} from "@/types/timesheet"
import { parseCommitLog, parseCommitMessage } from "@/utils/commitParser"
import {
  NOT_LOGGED,
  reconcileWithOdoo,
  type OdooReconciliation,
} from "@/utils/odooReconciliation"
import { getPresetPeriod } from "@/utils/period"
import {
  canVerify,
  isEditable,
  isSubmittable,
  roundHours,
  type SubmittableEntry,
} from "@/utils/timesheetRules"

const DEFAULT_HOURS = 1

type FailedSubmission = Extract<SubmissionResult, { success: false }>

interface DatedCommit {
  commit: ParsedCommit
  date: string
}

interface TaskResolution {
  id: string
  task: OdooTaskMatch | null
  reconciliation: OdooReconciliation
}

interface VerifiedEntry {
  entry: TimesheetEntry
  task: OdooTaskMatch
}

type TimesheetAction =
  | { type: "entriesAdded"; entries: TimesheetEntry[] }
  | { type: "entryRemoved"; id: string }
  | { type: "descriptionChanged"; id: string; description: string }
  | { type: "hoursChanged"; id: string; hours: number }
  | { type: "verificationStarted"; ids: string[] }
  | { type: "verificationResolved"; resolutions: TaskResolution[] }
  | { type: "verificationFailed"; ids: string[]; message: string }
  | { type: "submissionStarted"; ids: string[] }
  | { type: "submissionResolved"; ids: string[]; results: SubmissionResult[] }
  | { type: "submissionFailed"; ids: string[]; message: string }

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
  patch: Partial<Pick<TimesheetEntry, "description" | "hours">>
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

function resolveVerification(
  entry: TimesheetEntry,
  { task, reconciliation }: TaskResolution
): TimesheetEntry {
  const base = { ...entry, activity: "idle" as const, task }
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

    case "descriptionChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, { description: action.description })
      )

    case "hoursChanged":
      return updateWhere(entries, new Set([action.id]), (entry) =>
        applyEdit(entry, { hours: action.hours })
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
        task: null,
        status: "error",
        statusDetail: { reason: "serverError", message: action.message },
        loggedHours: 0,
      }))

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
  }
}

function createEntry({ commit, date }: DatedCommit): TimesheetEntry {
  const hasTaskRef = commit.taskRef !== null
  return {
    id: crypto.randomUUID(),
    commit,
    description: commit.formattedDescription,
    hours: DEFAULT_HOURS,
    date,
    status: hasTaskRef ? "pending" : "missing",
    task: null,
    activity: "idle",
    statusDetail: hasTaskRef ? null : { reason: "noTaskReference" },
    odooTimesheetId: null,
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
    verified.map(({ entry, task }) => ({
      id: entry.id,
      description: entry.description,
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
  importFromGithub: () => Promise<ImportSummary>
  verifyEntry: (id: string) => Promise<VerificationSummary>
  updateDescription: (id: string, description: string) => void
  updateHours: (id: string, hours: number) => void
  removeEntry: (id: string) => void
  submitEntry: (id: string) => Promise<SubmissionSummary>
  submitAll: () => Promise<SubmissionSummary>
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
        const taskRefs = [...new Set(verifiable.map((e) => e.commit.taskRef))]
        const results = await searchTasks(taskRefs)
        const byRef = new Map(results.map((result) => [result.taskRef, result]))
        const matches: { entry: TimesheetEntry; task: OdooTaskMatch | null }[] =
          verifiable.map((entry) => ({
            entry,
            task: toTaskMatch(byRef.get(entry.commit.taskRef)),
          }))
        const verified = matches.filter(
          (match): match is VerifiedEntry => match.task !== null
        )
        const reconciliations = await reconcile(verified)
        const resolutions = matches.map(({ entry, task }) => ({
          id: entry.id,
          task,
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
      addAndVerify(parseCommitLog(raw).map((commit) => ({ commit, date }))),
    [addAndVerify]
  )

  const importFromGithub = useCallback(async (): Promise<ImportSummary> => {
    setIsImporting(true)
    try {
      const rawCommits = await fetchCommits(period)
      const dated = rawCommits.flatMap(({ message, date }) => {
        const commit = parseCommitMessage(message)
        return commit === null ? [] : [{ commit, date }]
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
    updateDescription,
    updateHours,
    removeEntry,
    submitEntry,
    submitAll,
  }
}
