import { describe, expect, it } from "vitest"

import { rollPeriodToToday } from "@/utils/period"

describe("rollPeriodToToday", () => {
  it("moves today to the new day", () => {
    expect(
      rollPeriodToToday(
        { from: "2026-11-24", to: "2026-11-24" },
        "2026-11-24",
        "2026-11-25"
      )
    ).toEqual({ from: "2026-11-25", to: "2026-11-25" })
  })

  it("moves this week on a Monday", () => {
    expect(
      rollPeriodToToday(
        { from: "2026-11-23", to: "2026-11-29" },
        "2026-11-29",
        "2026-11-30"
      )
    ).toEqual({ from: "2026-11-30", to: "2026-12-06" })
  })

  it("keeps a period picked by hand", () => {
    const picked = { from: "2026-11-02", to: "2026-11-05" }
    expect(rollPeriodToToday(picked, "2026-11-24", "2026-11-25")).toBe(picked)
  })
})
