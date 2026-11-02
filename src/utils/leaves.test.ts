import { describe, expect, it } from "vitest"

import type { Attendance, LeaveRequest, LeaveType } from "@/types/timesheet"
import {
  attendanceHours,
  formatDuration,
  formatHourOfDay,
  groupAttendanceByDay,
  leaveStateTone,
  parseHourOfDay,
  splitRequests,
  countWorkingDays,
  expectedPeriodHours,
  filterRequests,
  findAttendanceAnomalies,
  findRemoteWorkType,
  holidayDates,
  isRemoteDay,
  monthWeeks,
  nextWorkingDay,
} from "@/utils/leaves"

function attendance(overrides: Partial<Attendance>): Attendance {
  return {
    attendanceId: 1,
    checkIn: "2026-10-27T05:00:00Z",
    checkOut: "2026-10-27T13:00:00Z",
    workedHours: 8,
    ...overrides,
  }
}

function request(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    instanceIndex: 2,
    leaveId: 1,
    leaveTypeId: 1,
    leaveTypeName: "Congés payés",
    dateFrom: "2026-10-20",
    dateTo: "2026-10-20",
    period: null,
    hourFrom: null,
    hourTo: null,
    days: 1,
    duration: "1 jours",
    description: "",
    state: "validate",
    canDelete: false,
    canEdit: false,
    ...overrides,
  }
}

describe("groupAttendanceByDay", () => {
  const period = { from: "2026-10-26", to: "2026-11-01" }
  const now = new Date("2026-10-28T09:00:00Z")

  it("groups by local day, newest first, and counts the open attendance", () => {
    const days = groupAttendanceByDay(
      [
        attendance({ attendanceId: 1, checkIn: "2026-10-27T05:00:00Z" }),
        attendance({
          attendanceId: 2,
          checkIn: "2026-10-28T06:00:00Z",
          checkOut: null,
          workedHours: 0,
        }),
        // 21:30 UTC on the 25th is the 26th at 00:30 in Madagascar.
        attendance({
          attendanceId: 3,
          checkIn: "2026-10-25T21:30:00Z",
          checkOut: "2026-10-25T22:30:00Z",
        }),
        // Outside the period.
        attendance({ attendanceId: 4, checkIn: "2026-10-20T05:00:00Z" }),
      ],
      period,
      now
    )
    expect(days.map((day) => [day.date, day.hours])).toEqual([
      ["2026-10-28", 3],
      ["2026-10-27", 8],
      ["2026-10-26", 1],
    ])
  })

  it("counts the time present, not Odoo's worked hours without the lunch break", () => {
    expect(
      attendanceHours(
        attendance({
          checkIn: "2026-10-29T06:01:00Z",
          checkOut: "2026-10-29T09:33:00Z",
          workedHours: 2.96,
        }),
        now
      )
    ).toBeCloseTo(3.53, 2)
  })

  it("never counts negative time", () => {
    expect(
      attendanceHours(
        attendance({ checkIn: "2026-10-28T10:00:00Z", checkOut: null }),
        now
      )
    ).toBe(0)
  })
})

describe("hours of the day", () => {
  it("formats and parses Odoo's float hours", () => {
    expect(formatHourOfDay(9.5)).toBe("09:30")
    expect(formatHourOfDay(14.25)).toBe("14:15")
    expect(parseHourOfDay("09:30")).toBe(9.5)
    expect(parseHourOfDay("8:00")).toBe(8)
    expect(parseHourOfDay("25:00")).toBeNull()
    expect(parseHourOfDay("9h")).toBeNull()
  })
})

describe("formatDuration", () => {
  it("shows hours and minutes like Odoo", () => {
    expect(formatDuration(7.44)).toBe("7:26")
    expect(formatDuration(3.72)).toBe("3:43")
    expect(formatDuration(0.05)).toBe("0:03")
    expect(formatDuration(10)).toBe("10:00")
    expect(formatDuration(-1)).toBe("0:00")
  })
})

describe("splitRequests", () => {
  it("puts running and future requests first, in date order", () => {
    const { upcoming, past } = splitRequests(
      [
        request({ leaveId: 1, dateFrom: "2026-10-20", dateTo: "2026-10-21" }),
        request({ leaveId: 2, dateFrom: "2026-11-10", dateTo: "2026-11-12" }),
        request({ leaveId: 3, dateFrom: "2026-10-27", dateTo: "2026-10-29" }),
        request({ leaveId: 4, dateFrom: "2026-09-01", dateTo: "2026-09-01" }),
      ],
      "2026-10-28"
    )
    expect(upcoming.map((item) => item.leaveId)).toEqual([3, 2])
    expect(past.map((item) => item.leaveId)).toEqual([1, 4])
  })
})

describe("leaveStateTone", () => {
  it("maps Odoo states to badge tones", () => {
    expect(leaveStateTone("confirm")).toBe("pending")
    expect(leaveStateTone("validate1")).toBe("pending")
    expect(leaveStateTone("validate")).toBe("approved")
    expect(leaveStateTone("refuse")).toBe("refused")
    expect(leaveStateTone("cancel")).toBe("canceled")
  })
})

function leaveType(overrides: Partial<LeaveType>): LeaveType {
  return {
    instanceIndex: 2,
    leaveTypeId: 1,
    name: "Congés payés",
    unit: "day",
    requiresAllocation: true,
    workedTime: false,
    remaining: 10,
    allocated: 20,
    ...overrides,
  }
}

// Monday 2026-10-26 to Friday 2026-10-30, in Madagascar (UTC+3).
const WEEK = { from: "2026-10-26", to: "2026-11-01" }
const REMOTE = new Set(["2:9"])

describe("holidays and working days", () => {
  it("lists the local days of a public holiday", () => {
    const dates = holidayDates([
      {
        name: "Toussaint",
        from: "2026-10-31T21:00:00Z",
        to: "2026-11-01T20:59:59Z",
      },
    ])
    expect([...dates.keys()]).toEqual(["2026-11-01"])
  })

  it("skips weekends and holidays", () => {
    const holidays = new Map([["2026-10-26", "Fête"]])
    expect(nextWorkingDay("2026-10-23", holidays)).toBe("2026-10-27")
    expect(countWorkingDays("2026-10-23", "2026-10-28", holidays)).toBe(3)
  })

  it("lays a month out in weeks from Monday", () => {
    const weeks = monthWeeks("2026-11")
    expect(weeks[0][0]).toBe("2026-10-26")
    expect(weeks.at(-1)?.at(-1)).toBe("2026-12-06")
    expect(weeks.every((week) => week.length === 7)).toBe(true)
  })
})

describe("remote work", () => {
  const remote = (overrides: Partial<LeaveRequest>) =>
    request({
      leaveTypeId: 9,
      dateFrom: "2026-10-27",
      dateTo: "2026-10-27",
      ...overrides,
    })

  it("counts a day or an afternoon, not a morning", () => {
    expect(isRemoteDay([remote({})], REMOTE, "2026-10-27")).toBe(true)
    expect(isRemoteDay([remote({ period: "pm" })], REMOTE, "2026-10-27")).toBe(
      true
    )
    expect(isRemoteDay([remote({ period: "am" })], REMOTE, "2026-10-27")).toBe(
      false
    )
    expect(
      isRemoteDay([remote({ state: "refuse" })], REMOTE, "2026-10-27")
    ).toBe(false)
    expect(isRemoteDay([remote({})], new Set(), "2026-10-27")).toBe(false)
  })

  it("finds the remote work type", () => {
    const types = [
      leaveType({}),
      leaveType({ leaveTypeId: 8, name: "Formation", workedTime: true }),
      leaveType({ leaveTypeId: 9, name: "Télétravail", workedTime: true }),
    ]
    expect(findRemoteWorkType(types)?.leaveTypeId).toBe(9)
    expect(findRemoteWorkType(types.slice(0, 2))?.leaveTypeId).toBe(8)
    expect(findRemoteWorkType(types.slice(0, 1))).toBeNull()
  })
})

describe("findAttendanceAnomalies", () => {
  const day = (date: string, hours: number, open = false) => ({
    date,
    hours,
    attendances: [
      attendance({
        checkIn: `${date}T06:00:00Z`,
        checkOut: open ? null : `${date}T14:00:00Z`,
      }),
    ],
  })

  it("flags forgotten check-outs, missing and short days", () => {
    const anomalies = findAttendanceAnomalies({
      days: [
        day("2026-10-26", 8),
        day("2026-10-27", 6),
        day("2026-10-28", 3, true),
      ],
      period: WEEK,
      today: "2026-10-30",
      requests: [],
      workedTypes: REMOTE,
      holidays: new Map(),
      expectedHours: (remote) => (remote ? 8.5 : 8),
    })
    expect(anomalies).toEqual([
      { kind: "noAttendance", date: "2026-10-29" },
      {
        kind: "forgottenCheckOut",
        date: "2026-10-28",
        checkIn: "2026-10-28T06:00:00Z",
      },
      { kind: "short", date: "2026-10-27", hours: 6, expected: 8 },
    ])
  })

  it("leaves days off, holidays and remote hours alone", () => {
    const anomalies = findAttendanceAnomalies({
      days: [day("2026-10-26", 8)],
      period: WEEK,
      today: "2026-10-30",
      requests: [
        request({ dateFrom: "2026-10-27", dateTo: "2026-10-28" }),
        request({
          leaveTypeId: 9,
          dateFrom: "2026-10-26",
          dateTo: "2026-10-26",
        }),
      ],
      workedTypes: REMOTE,
      holidays: new Map([["2026-10-29", "Fête"]]),
      expectedHours: (remote) => (remote ? 8.5 : 8),
    })
    expect(anomalies).toEqual([
      { kind: "short", date: "2026-10-26", hours: 8, expected: 8.5 },
    ])
  })
})

describe("filterRequests", () => {
  it("filters by type and state", () => {
    const requests = [
      request({ leaveId: 1 }),
      request({ leaveId: 2, state: "confirm" }),
      request({ leaveId: 3, leaveTypeName: "Maladie" }),
    ]
    expect(
      filterRequests(requests, "Congés payés", "").map((r) => r.leaveId)
    ).toEqual([1, 2])
    expect(
      filterRequests(requests, "", "pending").map((r) => r.leaveId)
    ).toEqual([2])
  })
})

describe("expectedPeriodHours", () => {
  it("counts working days, less time off and holidays", () => {
    expect(
      expectedPeriodHours({
        period: WEEK,
        today: "2026-11-02",
        requests: [
          request({
            dateFrom: "2026-10-27",
            dateTo: "2026-10-27",
            period: "am",
          }),
          request({
            dateFrom: "2026-10-28",
            dateTo: "2026-10-28",
            hourFrom: 9,
            hourTo: 11,
          }),
          request({
            leaveTypeId: 9,
            dateFrom: "2026-10-30",
            dateTo: "2026-10-30",
          }),
        ],
        workedTypes: REMOTE,
        holidays: new Map([["2026-10-29", "Fête"]]),
        expectedHours: (remote) => (remote ? 8.5 : 8),
      })
    ).toBe(8 + 4 + 6 + 8.5)
  })
})
