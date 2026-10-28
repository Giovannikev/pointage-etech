import { describe, expect, it } from "vitest"

import type { Attendance, LeaveRequest } from "@/types/timesheet"
import {
  attendanceHours,
  formatHourOfDay,
  groupAttendanceByDay,
  leaveStateTone,
  parseHourOfDay,
  splitRequests,
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
          workedHours: 1,
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
