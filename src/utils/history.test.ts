import { describe, expect, it } from "vitest"

import { historyEntry } from "@/test/fixtures"
import type { TimesheetHistoryInstanceResult } from "@/types/timesheet"
import {
  analyzeDayLoad,
  buildHistoryGrid,
  chartDays,
  filterHistory,
  groupByDay,
  historyToCsv,
  listLoggableTasks,
  summarizeHistory,
} from "@/utils/history"

const results: TimesheetHistoryInstanceResult[] = [
  {
    instanceIndex: 1,
    ok: true,
    truncated: false,
    entries: [
      historyEntry({
        timesheetId: 1,
        date: "2026-10-12",
        hours: 5,
        description: "=SUM(A1)",
        projectName: "P;1",
      }),
      historyEntry({
        timesheetId: 2,
        date: "2026-10-12",
        hours: 3.5,
        taskId: null,
        taskName: null,
      }),
      historyEntry({
        timesheetId: 3,
        date: "2026-10-13",
        hours: 6,
        taskId: 2,
        taskName: "Other",
      }),
    ],
  },
  { instanceIndex: 2, ok: false, error: "unreachable" },
]

describe("history summary", () => {
  const entries = filterHistory(results, { instance: "all", query: "" })
  const days = groupByDay(entries)

  it("sorts newest first and groups by day", () => {
    expect(days.map((day) => [day.date, day.hours])).toEqual([
      ["2026-10-13", 6],
      ["2026-10-12", 8.5],
    ])
  })

  it("sums and checks the 8 h days", () => {
    expect(summarizeHistory(days)).toEqual({
      totalHours: 14.5,
      loggedDays: 2,
      averagePerDay: 7.25,
      fullDays: 1,
      shortDays: 1,
      target: 8,
    })
  })

  it("charts the weekdays up to today, empty ones included", () => {
    const chart = chartDays(
      days,
      { from: "2026-10-12", to: "2026-10-18" },
      "2026-10-15"
    )
    expect(chart.map((day) => [day.date, day.hours])).toEqual([
      ["2026-10-12", 8.5],
      ["2026-10-13", 6],
      ["2026-10-14", 0],
      ["2026-10-15", 0],
    ])
  })

  it("filters by search words", () => {
    expect(
      filterHistory(results, { instance: "all", query: "other" })
    ).toHaveLength(1)
  })
})

describe("historyToCsv", () => {
  it("escapes separators and formulas, and localizes decimals", () => {
    const csv = historyToCsv(
      filterHistory(results, { instance: "all", query: "" }),
      {
        separator: ";",
        decimalSeparator: ",",
        headers: [
          "Date",
          "Instance",
          "Project",
          "Task",
          "Description",
          "Hours",
        ],
        instanceLabel: () => "PMO",
      }
    )
    expect(csv).toContain("'=SUM(A1);5")
    expect(csv).toContain('"P;1"')
    expect(csv).toContain(";3,5")
    expect(csv.split("\r\n")).toHaveLength(4)
  })
})

describe("buildHistoryGrid", () => {
  it("puts tasks in rows and days in columns", () => {
    const entries = filterHistory(results, { instance: "all", query: "" })
    const grid = buildHistoryGrid(entries, {
      from: "2026-10-12",
      to: "2026-10-14",
    })
    expect(grid?.dates).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"])
    expect(grid?.rows.map((row) => [row.label, row.total])).toEqual([
      ["Other", 6],
      ["Task", 5],
      ["Project", 3.5],
    ])
    expect(grid?.totalsByDate.get("2026-10-12")).toBe(8.5)
    expect(grid?.total).toBe(14.5)
  })

  it("refuses periods longer than a month", () => {
    expect(
      buildHistoryGrid([], { from: "2026-01-01", to: "2026-03-01" })
    ).toBeNull()
  })
})

describe("analyzeDayLoad", () => {
  it("reports the day, the task, duplicates and long days", () => {
    const load = analyzeDayLoad(results, {
      instanceIndex: 1,
      taskId: 1,
      hours: 3,
      description: "  =sum(a1) ",
    })
    expect(load).toMatchObject({
      dayHours: 14.5,
      taskHours: 5,
      totalAfter: 17.5,
      exceedsLimit: true,
      hasDuplicate: true,
    })
  })
})

describe("listLoggableTasks", () => {
  it("lists recent tasks first, then other assigned ones", () => {
    const tasks = listLoggableTasks(
      filterHistory(results, { instance: "all", query: "" }),
      [
        {
          instanceIndex: 1,
          taskId: 1,
          projectId: 10,
          name: "Task",
          projectName: "Project",
        },
        {
          instanceIndex: 2,
          taskId: 9,
          projectId: 4,
          name: "Assigned",
          projectName: "X",
        },
        {
          instanceIndex: 2,
          taskId: 8,
          projectId: null,
          name: "Private",
          projectName: null,
        },
      ]
    )
    expect(tasks.map((task) => [task.name, task.isRecent])).toEqual([
      ["Other", true],
      ["Task", true],
      ["Assigned", false],
    ])
  })
})
