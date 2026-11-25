import { beforeEach, describe, expect, it } from "vitest"

import type { TimesheetEntry } from "@/types/timesheet"
import { loadTimesheetDraft, saveTimesheetDraft } from "@/utils/timesheetDraft"

const storage = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
}

function entry(changes: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: "a",
    commit: {} as TimesheetEntry["commit"],
    description: "03-038 - Dev : contrôle SIREN",
    isDescriptionEdited: false,
    hours: 2,
    isHoursEdited: true,
    date: "2026-11-25",
    authoredAt: null,
    status: "found",
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

describe("timesheet draft", () => {
  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage,
      configurable: true,
    })
  })

  it("gives back the lines saved for the same user only", () => {
    saveTimesheetDraft("user-1", [entry()])
    expect(loadTimesheetDraft("user-1")).toEqual([entry()])
    expect(loadTimesheetDraft("user-2")).toEqual([])
  })

  it("marks a line interrupted while sending as to check", () => {
    saveTimesheetDraft("user-1", [entry({ activity: "submitting" })])
    expect(loadTimesheetDraft("user-1")[0]).toMatchObject({
      activity: "idle",
      status: "error",
      statusDetail: { reason: "noOdooResult" },
    })
  })

  it("forgets the draft once the list is empty", () => {
    saveTimesheetDraft("user-1", [entry()])
    saveTimesheetDraft("user-1", [])
    expect(storage.size).toBe(0)
  })

  it("ignores an unreadable draft", () => {
    storage.set("pointage:timesheet-draft:user-1", "{not json")
    expect(loadTimesheetDraft("user-1")).toEqual([])
  })
})
