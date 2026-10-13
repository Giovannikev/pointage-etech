import { describe, expect, it } from "vitest"

import { addDays, countDays, isIsoDate, toLocalIsoDate } from "@/utils/date"

// vitest.config.ts runs the tests in Madagascar's time zone (UTC+3).
describe("toLocalIsoDate", () => {
  it("keeps plain dates", () => {
    expect(toLocalIsoDate("2026-10-15")).toBe("2026-10-15")
  })
  it("turns an Odoo UTC datetime into the local day", () => {
    expect(toLocalIsoDate("2026-10-14T21:00:00Z")).toBe("2026-10-15")
    expect(toLocalIsoDate("2026-10-14T20:59:00Z")).toBe("2026-10-14")
  })
})

describe("date helpers", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false)
    expect(isIsoDate("2028-02-29")).toBe(true)
  })
  it("counts and adds days", () => {
    expect(countDays("2026-10-12", "2026-10-18")).toBe(7)
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
  })
})
