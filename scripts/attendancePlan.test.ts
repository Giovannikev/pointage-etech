import { describe, expect, it } from "vitest"
import {
  leaveOffIntervals,
  localMidnight,
  localMoment,
  parseClock,
  planPunches,
  toLocalInterval,
  type LeaveSpan,
  type WorkSchedule,
} from "../supabase/functions/_shared/attendancePlan.ts"

// 09:00-12:30 and 13:30-18:00.
const schedule: WorkSchedule = { morning: [540, 750], afternoon: [810, 1080] }
const DATE = "2026-11-02"

function punchesWith(leaves: LeaveSpan[]) {
  return planPunches(
    schedule,
    leaves.flatMap((leave) => leaveOffIntervals(leave, DATE, schedule))
  ).map(({ minute, action }) => `${action} ${minute}`)
}

describe("planPunches", () => {
  it("punches four times on a plain day", () => {
    expect(punchesWith([])).toEqual(["in 540", "out 750", "in 810", "out 1080"])
  })

  it("skips a day off", () => {
    expect(
      punchesWith([{ unit: "day", dateFrom: "2026-10-30", dateTo: "2026-11-03" }])
    ).toEqual([])
  })

  it("keeps the other days of a leave", () => {
    expect(
      punchesWith([{ unit: "day", dateFrom: "2026-11-03", dateTo: "2026-11-04" }])
    ).toHaveLength(4)
  })

  it("works the afternoon after a morning off", () => {
    expect(
      punchesWith([
        {
          unit: "half_day",
          dateFrom: DATE,
          dateTo: DATE,
          fromPeriod: "am",
          toPeriod: "am",
        },
      ])
    ).toEqual(["in 810", "out 1080"])
  })

  it("works the morning before an afternoon off", () => {
    expect(
      punchesWith([
        {
          unit: "half_day",
          dateFrom: DATE,
          dateTo: DATE,
          fromPeriod: "pm",
          toPeriod: "pm",
        },
      ])
    ).toEqual(["in 540", "out 750"])
  })

  it("reads half days spanning several days", () => {
    const leave: LeaveSpan = {
      unit: "half_day",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-03",
      fromPeriod: "pm",
      toPeriod: "am",
    }
    expect(punchesWith([leave])).toEqual([])
    expect(
      planPunches(schedule, leaveOffIntervals(leave, "2026-11-03", schedule))
    ).toEqual([
      { minute: 810, action: "in" },
      { minute: 1080, action: "out" },
    ])
  })

  it("leaves and comes back around hours off", () => {
    expect(
      punchesWith([{ unit: "hour", date: DATE, hourFrom: 14, hourTo: 16.5 }])
    ).toEqual(["in 540", "out 750", "in 810", "out 840", "in 990", "out 1080"])
  })

  it("starts later after hours off in the morning", () => {
    expect(
      punchesWith([{ unit: "hour", date: DATE, hourFrom: 8, hourTo: 10 }])
    ).toEqual(["in 600", "out 750", "in 810", "out 1080"])
  })
})

describe("time zones", () => {
  it("reads the local minute and weekday", () => {
    // 06:00 UTC is 09:00 in Madagascar, on a Monday.
    expect(
      localMoment(new Date("2026-11-02T06:00:00Z"), "Indian/Antananarivo")
    ).toEqual({ date: DATE, minute: 540, weekday: 1 })
    expect(localMoment(new Date(), "Not/AZone")).toBeNull()
  })

  it("finds local midnight", () => {
    expect(localMidnight(DATE, "Indian/Antananarivo").toISOString()).toBe(
      "2026-11-01T21:00:00.000Z"
    )
    expect(localMidnight(DATE, "America/New_York").toISOString()).toBe(
      "2026-11-02T05:00:00.000Z"
    )
  })

  it("clips a holiday to the local day", () => {
    const dayStart = localMidnight(DATE, "Indian/Antananarivo")
    expect(
      toLocalInterval(
        new Date("2026-11-01T20:00:00Z"),
        new Date("2026-11-02T20:59:59Z"),
        dayStart
      )
    ).toEqual([0, 1439.9833333333333])
    expect(
      toLocalInterval(
        new Date("2026-11-03T00:00:00Z"),
        new Date("2026-11-03T10:00:00Z"),
        dayStart
      )
    ).toBeNull()
  })

  it("parses schedule times", () => {
    expect(parseClock("09:00")).toBe(540)
    expect(parseClock("18:00:00")).toBe(1080)
    expect(parseClock("25:00")).toBeNull()
  })
})
