import { describe, expect, it } from "vitest"

import {
  nothingDue,
  outsideWorkingHours,
  routineDueOn,
  type PunchTiming,
} from "../supabase/functions/_shared/autoAttendanceTiming.ts"

// Madagascar is UTC+3 all year: 09:00 there is 06:00 UTC.
const TZ = "Indian/Antananarivo"
const at = (utc: string) => new Date(`${utc}Z`)

const timing: PunchTiming = {
  timezone: TZ,
  // 09:00-12:30 and 13:30-17:30.
  schedule: { morning: [540, 750], afternoon: [810, 1050] },
  remoteAfternoonEnd: 1080,
  randomWindow: 10,
  nextPunchAt: null,
}

describe("outsideWorkingHours", () => {
  it("is false during the working day", () => {
    // 2026-11-23 is a Monday.
    expect(outsideWorkingHours(timing, at("2026-11-23T06:00:00"))).toBe(false)
  })

  it("is true before the morning and on weekends", () => {
    expect(outsideWorkingHours(timing, at("2026-11-23T05:59:00"))).toBe(true)
    expect(outsideWorkingHours(timing, at("2026-11-28T09:00:00"))).toBe(true)
  })

  it("keeps the remote check-out, its random window and the catch-up time", () => {
    // 18:00 + 10 + 30 = 18:40 local, 15:40 UTC.
    expect(outsideWorkingHours(timing, at("2026-11-23T15:40:00"))).toBe(false)
    expect(outsideWorkingHours(timing, at("2026-11-23T15:41:00"))).toBe(true)
  })
})

describe("nothingDue", () => {
  it("reads Odoo on every quarter hour", () => {
    expect(nothingDue(timing, at("2026-11-23T06:15:00"))).toBe(false)
  })

  it("waits for the next punch in between", () => {
    const next = { ...timing, nextPunchAt: at("2026-11-23T06:20:00") }
    expect(nothingDue(next, at("2026-11-23T06:17:00"))).toBe(true)
    expect(nothingDue(next, at("2026-11-23T06:21:00"))).toBe(false)
  })

  it("waits when no punch is left today", () => {
    expect(nothingDue(timing, at("2026-11-23T06:17:00"))).toBe(true)
  })
})

describe("routineDueOn", () => {
  // 17:00 local.
  const routine = { timezone: TZ, logAt: 1020, lastLoggedOn: null }

  it("is due from its time, for two hours", () => {
    expect(routineDueOn(routine, at("2026-11-23T13:59:00"))).toBeNull()
    expect(routineDueOn(routine, at("2026-11-23T14:00:00"))).toBe("2026-11-23")
    expect(routineDueOn(routine, at("2026-11-23T16:00:00"))).toBe("2026-11-23")
    expect(routineDueOn(routine, at("2026-11-23T16:01:00"))).toBeNull()
  })

  it("isn't due twice the same day, nor on weekends", () => {
    const logged = { ...routine, lastLoggedOn: "2026-11-23" }
    expect(routineDueOn(logged, at("2026-11-23T14:30:00"))).toBeNull()
    expect(routineDueOn(routine, at("2026-11-28T14:30:00"))).toBeNull()
  })
})
