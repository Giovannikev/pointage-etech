import { describe, expect, it } from "vitest"

import type {
  OdooTaskMatch,
  ParsedCommit,
  TimesheetEntry,
} from "@/types/timesheet"
import { NOT_LOGGED } from "@/utils/odooReconciliation"
import { timesheetReducer } from "@/utils/timesheetReducer"

const TASK: OdooTaskMatch = {
  taskId: 38,
  taskName: "Contrôle SIREN",
  projectId: 3,
  projectName: "Client",
  instanceIndex: 1,
}

function commit(rawMessage: string): ParsedCommit {
  return {
    rawMessage,
    taskRef: "03-038",
    moduleName: null,
    action: null,
    rawDescription: rawMessage,
    frenchSummary: "",
  }
}

function entry(changes: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: "a",
    commit: commit("[ADD] 03-038 SIREN check"),
    description: "03-038 - Dev : contrôle SIREN",
    isDescriptionEdited: false,
    hours: 1,
    isHoursEdited: false,
    date: "2026-11-25",
    authoredAt: null,
    status: "pending",
    task: null,
    isTaskManual: false,
    activity: "idle",
    statusDetail: null,
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours: 0,
    ...changes,
  }
}

describe("timesheetReducer", () => {
  describe("verificationResolved", () => {
    it("marks a line without a task as missing", () => {
      const [line] = timesheetReducer(
        [entry({ activity: "verifying", loggedHours: 2 })],
        {
          type: "verificationResolved",
          resolutions: [
            {
              id: "a",
              task: null,
              description: "03-038",
              reconciliation: NOT_LOGGED,
            },
          ],
        }
      )
      expect(line).toMatchObject({
        activity: "idle",
        status: "missing",
        statusDetail: { reason: "taskNotFound", taskRef: "03-038" },
        loggedHours: 0,
      })
    })

    it("marks a found line ready, with the hours already logged that day", () => {
      const [line] = timesheetReducer([entry({ activity: "verifying" })], {
        type: "verificationResolved",
        resolutions: [
          {
            id: "a",
            task: TASK,
            description: "new description",
            reconciliation: { duplicate: null, loggedHours: 3 },
          },
        ],
      })
      expect(line).toMatchObject({
        activity: "idle",
        status: "found",
        task: TASK,
        description: "new description",
        loggedHours: 3,
      })
    })

    it("mirrors the timesheet Odoo already holds for the line", () => {
      const [line] = timesheetReducer([entry({ activity: "verifying" })], {
        type: "verificationResolved",
        resolutions: [
          {
            id: "a",
            task: TASK,
            description: "03-038",
            reconciliation: {
              duplicate: {
                instanceIndex: 1,
                taskId: 38,
                date: "2026-11-25",
                timesheetId: 501,
                hours: 2.5,
                description: "03-038",
                locked: true,
              },
              loggedHours: 2.5,
            },
          },
        ],
      })
      expect(line).toMatchObject({
        status: "logged",
        statusDetail: { reason: "alreadyLogged" },
        hours: 2.5,
        odooTimesheetId: 501,
        odooLocked: true,
      })
    })

    it("leaves the other lines untouched", () => {
      const other = entry({ id: "b", commit: commit("[FIX] other") })
      const next = timesheetReducer([entry(), other], {
        type: "verificationResolved",
        resolutions: [
          {
            id: "a",
            task: TASK,
            description: "",
            reconciliation: NOT_LOGGED,
          },
        ],
      })
      expect(next[1]).toBe(other)
    })
  })

  describe("submissionResolved", () => {
    const sending = [
      entry({ id: "ok", activity: "submitting", status: "found", task: TASK }),
      entry({
        id: "ko",
        commit: commit("[FIX] 03-038 b"),
        activity: "submitting",
        status: "found",
        task: TASK,
      }),
      entry({
        id: "lost",
        commit: commit("[FIX] 03-038 c"),
        activity: "submitting",
        status: "found",
        task: TASK,
      }),
    ]

    const next = timesheetReducer(sending, {
      type: "submissionResolved",
      ids: ["ok", "ko", "lost"],
      results: [
        { clientId: "ok", success: true, timesheetId: 77 },
        { clientId: "ko", success: false, error: "Access denied" },
      ],
    })

    it("marks a created line submitted with its Odoo id", () => {
      expect(next[0]).toMatchObject({
        activity: "idle",
        status: "submitted",
        statusDetail: null,
        odooTimesheetId: 77,
      })
    })

    it("marks a refused line failed with Odoo's message", () => {
      expect(next[1]).toMatchObject({
        activity: "idle",
        status: "error",
        statusDetail: { reason: "serverError", message: "Access denied" },
      })
    })

    it("marks a line Odoo didn't answer for as to check", () => {
      expect(next[2]).toMatchObject({
        activity: "idle",
        status: "error",
        statusDetail: { reason: "noOdooResult" },
      })
    })
  })

  describe("periodApplied", () => {
    it("drops the idle lines of other days and keeps those being sent", () => {
      const next = timesheetReducer(
        [
          entry({ id: "in", date: "2026-11-25" }),
          entry({ id: "before", date: "2026-11-20" }),
          entry({ id: "sending", date: "2026-11-20", activity: "submitting" }),
        ],
        {
          type: "periodApplied",
          period: { from: "2026-11-24", to: "2026-11-25" },
        }
      )
      expect(next.map((line) => line.id)).toEqual(["in", "sending"])
    })
  })
})
