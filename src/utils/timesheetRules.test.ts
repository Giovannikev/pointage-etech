import { describe, expect, it } from "vitest"

import { timesheetEntry } from "@/test/fixtures"
import {
  canAssignTask,
  canVerify,
  findSameReferenceLines,
} from "@/utils/timesheetRules"

const noReference = {
  rawMessage: "fix typo",
  taskRef: null,
  moduleName: null,
  action: "fix" as const,
  rawDescription: "fix typo",
  frenchSummary: "Correction de typo",
}

describe("canVerify", () => {
  it("checks lines with a reference, or with a task picked by hand", () => {
    expect(canVerify(timesheetEntry())).toBe(true)
    expect(canVerify(timesheetEntry({ commit: noReference, task: null }))).toBe(
      false
    )
    expect(
      canVerify(timesheetEntry({ commit: noReference, isTaskManual: true }))
    ).toBe(true)
  })

  it("leaves lines already in Odoo alone", () => {
    expect(canVerify(timesheetEntry({ status: "submitted" }))).toBe(false)
    expect(canAssignTask(timesheetEntry({ status: "logged" }))).toBe(false)
  })
})

describe("findSameReferenceLines", () => {
  const missing = (id: string, taskRef: string | null) =>
    timesheetEntry({
      id,
      status: "missing",
      task: null,
      commit: { ...timesheetEntry().commit, taskRef },
    })

  it("finds the other lines without a task that share the reference", () => {
    const line = missing("a", "03-500")
    const entries = [
      line,
      missing("b", "03-500"),
      missing("c", "03-501"),
      timesheetEntry({ id: "d" }),
      { ...missing("e", "03-500"), activity: "verifying" as const },
    ]
    expect(
      findSameReferenceLines(line, entries).map((entry) => entry.id)
    ).toEqual(["b"])
  })

  it("groups nothing for commits without a reference", () => {
    const line = missing("a", null)
    expect(findSameReferenceLines(line, [line, missing("b", null)])).toEqual([])
  })
})
