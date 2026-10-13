import { describe, expect, it } from "vitest"

import { timesheetEntry } from "@/test/fixtures"
import type { LoggedTimesheet } from "@/types/timesheet"
import { reconcileWithOdoo } from "@/utils/odooReconciliation"

const task = timesheetEntry().task!

const logged = (overrides: Partial<LoggedTimesheet>): LoggedTimesheet => ({
  instanceIndex: 1,
  taskId: 1,
  date: "2026-10-12",
  timesheetId: 50,
  hours: 2,
  description: "Ajout de la fonction x",
  locked: false,
  ...overrides,
})

describe("reconcileWithOdoo", () => {
  it("matches a same-description line once, and sums the day's hours", () => {
    const result = reconcileWithOdoo(
      [
        {
          id: "a",
          description: "  ajout de la FONCTION x ",
          date: "2026-10-12",
          task,
        },
        {
          id: "b",
          description: "Ajout de la fonction x",
          date: "2026-10-12",
          task,
        },
      ],
      [
        logged({}),
        logged({ timesheetId: 51, description: "Autre", hours: 1.5 }),
      ]
    )
    expect(result.get("a")?.duplicate?.timesheetId).toBe(50)
    expect(result.get("b")?.duplicate).toBeNull()
    expect(result.get("b")?.loggedHours).toBe(3.5)
  })
})
