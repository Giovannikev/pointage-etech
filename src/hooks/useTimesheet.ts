import i18n from "i18next"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { logOnTarget, matchTarget } from "@/components/timesheet/logTarget"
import { fetchCommits } from "@/services/commitSourceService"
import {
  deleteTimesheet,
  findLoggedTicketTimesheets,
  findLoggedTimesheets,
  searchTasks,
  submitTimesheets,
  updateTimesheet,
} from "@/services/odooService"
import type {
  CommitPeriod,
  ImportSummary,
  OdooTaskMatch,
  SubmissionResult,
  SubmissionSummary,
  TaskSearchResult,
  TimesheetChanges,
  TimesheetEntry,
  TimesheetLookup,
  VerificationSummary,
} from "@/types/timesheet"
import { parseCommitMessage, parsePastedCommits } from "@/utils/commitParser"
import {
  NOT_LOGGED,
  reconcileWithOdoo,
  type OdooReconciliation,
} from "@/utils/odooReconciliation"
import { loadTimesheetDraft, saveTimesheetDraft } from "@/utils/timesheetDraft"
import { usePresetPeriod } from "@/hooks/usePresetPeriod"
import { describeCommit } from "@/utils/timesheetDescription"
import {
  createEntry,
  timesheetReducer,
  toEstimateLine,
  withManualTask,
  type DatedCommit,
  type TimesheetAction,
} from "@/utils/timesheetReducer"
import {
  canAssignTask,
  canVerify,
  isInOdoo,
  isSubmittable,
  roundHours,
  type SubmittableEntry,
} from "@/utils/timesheetRules"
import { summarizeSubmission, toSubmission } from "@/utils/timesheetSubmission"
import { isTicketMatch, type TicketMatch } from "@/utils/timesheetTarget"

interface TaskMatch {
  entry: TimesheetEntry
  task: OdooTaskMatch | null
  /** Description to keep once verified: regenerated unless the user edited it. */
  description: string
}

type VerifiedEntry = TaskMatch & { task: OdooTaskMatch }

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

/**
 * Matches found lines with the timesheets the user already has in Odoo:
 * task lines through FIND_TIMESHEETS, ticket lines through the history.
 */
async function reconcile(
  verified: VerifiedEntry[]
): Promise<Map<string, OdooReconciliation>> {
  const taskLines = verified.filter(({ task }) => !isTicketMatch(task))
  const ticketLookups = verified.flatMap(({ entry, task }) =>
    isTicketMatch(task)
      ? [
          {
            instanceIndex: task.instanceIndex,
            ticketId: task.ticket.ticketId,
            date: entry.date,
          },
        ]
      : []
  )
  const [taskTimesheets, ticketTimesheets] = await Promise.all([
    taskLines.length > 0
      ? findLoggedTimesheets(taskLines.map(toLookup))
      : Promise.resolve([]),
    findLoggedTicketTimesheets(ticketLookups),
  ])
  const timesheets = [...taskTimesheets, ...ticketTimesheets]
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t("errors.generic")
}

type TicketEntry = SubmittableEntry & { task: TicketMatch }

function isTicketEntry(entry: SubmittableEntry): entry is TicketEntry {
  return isTicketMatch(entry.task)
}

/** Ticket lines go one by one through LOG_TICKET_TIME; results are per line. */
function submitTicketLines(
  entries: TicketEntry[]
): Promise<SubmissionResult[]> {
  return Promise.all(
    entries.map(async (entry): Promise<SubmissionResult> => {
      try {
        const timesheetId = await logOnTarget(matchTarget(entry.task), {
          hours: entry.hours,
          description: entry.description.trim(),
          date: entry.date,
        })
        return { clientId: entry.id, success: true, timesheetId }
      } catch (error) {
        return {
          clientId: entry.id,
          success: false,
          error: toErrorMessage(error),
        }
      }
    })
  )
}

/**
 * Task lines in one batch, failing line by line: ticket lines sent at the
 * same time may already be in Odoo, so a failing batch must not mark them.
 */
async function submitTaskBatch(
  entries: SubmittableEntry[]
): Promise<SubmissionResult[]> {
  if (entries.length === 0) {
    return []
  }
  try {
    return await submitTimesheets(entries.map(toSubmission))
  } catch (error) {
    const message = toErrorMessage(error)
    return entries.map((entry) => ({
      clientId: entry.id,
      success: false,
      error: message,
    }))
  }
}

/** Task lines in one SUBMIT_TIMESHEET batch, ticket lines on their ticket. */
async function submitLines(
  entries: SubmittableEntry[]
): Promise<SubmissionResult[]> {
  const ticketLines = entries.filter(isTicketEntry)
  const taskLines = entries.filter((entry) => !isTicketEntry(entry))
  if (ticketLines.length === 0) {
    // A failing batch marks its own lines failed, see submitTimesheets.
    return submitTimesheets(taskLines.map(toSubmission))
  }
  const [taskResults, ticketResults] = await Promise.all([
    submitTaskBatch(taskLines),
    submitTicketLines(ticketLines),
  ])
  return [...taskResults, ...ticketResults]
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

export function useTimesheet(userId: string): UseTimesheetResult {
  const [entries, setEntries] = useState(() => loadTimesheetDraft(userId))
  // The list as the last action left it, ahead of the next render: an import
  // reads which of its lines the reducer actually added.
  const latestEntries = useRef(entries)
  const dispatch = useCallback((action: TimesheetAction): void => {
    latestEntries.current = timesheetReducer(latestEntries.current, action)
    setEntries(latestEntries.current)
  }, [])
  const [period, setPeriod] = usePresetPeriod("today")

  // The lines survive a reload: see timesheetDraft.
  useEffect(() => saveTimesheetDraft(userId, entries), [userId, entries])

  // A line being sent when the tab closes may or may not reach Odoo.
  const isSubmitting = entries.some((entry) => entry.activity === "submitting")
  useEffect(() => {
    if (!isSubmitting) {
      return
    }
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isSubmitting])
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
    [dispatch]
  )

  const addAndVerify = useCallback(
    async (commits: DatedCommit[]): Promise<ImportSummary> => {
      const candidates = commits.map(createEntry)
      // The reducer skips the commits already in the list as it is now, not
      // as this render saw it: another import may have added them meanwhile.
      dispatch({ type: "entriesAdded", entries: candidates })
      const added = new Set(latestEntries.current.map((entry) => entry.id))
      const newEntries = candidates.filter((entry) => added.has(entry.id))
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
        duplicates: commits.length - newEntries.length,
        verification,
      }
    },
    [dispatch, verify]
  )

  const importFromText = useCallback(
    (raw: string, date: string): Promise<ImportSummary> =>
      addAndVerify(
        parsePastedCommits(raw, date).map(({ commit, authoredAt }) => ({
          commit,
          date,
          authoredAt,
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
  }, [addAndVerify, dispatch, period])

  const submit = useCallback(
    async (targets: TimesheetEntry[]): Promise<SubmissionSummary> => {
      const ready = targets.filter(isSubmittable)
      const ids = ready.map((entry) => entry.id)
      if (ids.length === 0) {
        return { submitted: 0, failed: 0, errorMessage: null }
      }

      dispatch({ type: "submissionStarted", ids })
      try {
        const results = await submitLines(ready)
        dispatch({ type: "submissionResolved", ids, results })
        return summarizeSubmission(ids, results)
      } catch (error) {
        const message = toErrorMessage(error)
        dispatch({ type: "submissionFailed", ids, message })
        return { submitted: 0, failed: ids.length, errorMessage: message }
      }
    },
    [dispatch]
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
    [dispatch, entries, verify]
  )

  const submitEntry = useCallback(
    (id: string) => submit(entries.filter((entry) => entry.id === id)),
    [entries, submit]
  )

  const submitAll = useCallback(() => submit(entries), [entries, submit])

  const updateDescription = useCallback(
    (id: string, description: string) => {
      dispatch({ type: "descriptionChanged", id, description })
    },
    [dispatch]
  )

  const updateHours = useCallback(
    (id: string, hours: number) => {
      dispatch({ type: "hoursChanged", id, hours })
    },
    [dispatch]
  )

  const removeEntry = useCallback(
    (id: string) => {
      dispatch({ type: "entryRemoved", id })
    },
    [dispatch]
  )

  const findOdooLine = useCallback(
    (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id)
      if (
        entry === undefined ||
        !isInOdoo(entry) ||
        entry.task === null ||
        entry.odooTimesheetId === null
      ) {
        throw new Error(i18n.t("errors.notInOdoo"))
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
    [dispatch, findOdooLine]
  )

  const deleteFromOdoo = useCallback(
    async (id: string): Promise<void> => {
      await deleteTimesheet(findOdooLine(id))
      dispatch({ type: "loggedEntryDeleted", id })
    },
    [dispatch, findOdooLine]
  )

  const estimateAllHours = useCallback((): void => {
    dispatch({ type: "hoursEstimated", dates: null })
  }, [dispatch])

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
