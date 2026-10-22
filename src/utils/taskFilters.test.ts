import { describe, expect, it } from "vitest"

import { kanbanTask } from "@/test/fixtures"
import type { AssigneesInstanceResult } from "@/types/timesheet"
import { matchesTaskSearch } from "@/utils/kanban"
import {
  assigneeNamesByKey,
  isAssigneeSelected,
  listAssigneeOptions,
  parseAssigneeParam,
  projectOptionsFrom,
  taskAssigneeNames,
  toggleAssignee,
} from "@/utils/taskFilters"

const results: AssigneesInstanceResult[] = [
  {
    instanceIndex: 1,
    ok: true,
    currentUserId: 7,
    truncated: false,
    users: [
      { instanceIndex: 1, userId: 3, name: "Zoé Rakoto" },
      { instanceIndex: 1, userId: 7, name: "Haingo" },
      { instanceIndex: 1, userId: 9, name: "Arnaud" },
    ],
  },
  {
    instanceIndex: 2,
    ok: true,
    currentUserId: 21,
    truncated: false,
    users: [
      { instanceIndex: 2, userId: 21, name: "Haingo" },
      { instanceIndex: 2, userId: 30, name: "Zoe Rakoto" },
    ],
  },
]

describe("listAssigneeOptions", () => {
  it("merges same-name users across instances and lists me first", () => {
    const options = listAssigneeOptions(results, "all")
    expect(options.map((option) => option.name)).toEqual([
      "Haingo",
      "Arnaud",
      "Zoé Rakoto",
    ])
    expect(options[0]).toMatchObject({ isMe: true, keys: ["1:7", "2:21"] })
    // Accents don't split a person in two.
    expect(options[2].keys).toEqual(["1:3", "2:30"])
  })

  it("keeps the selected instance only", () => {
    const options = listAssigneeOptions(results, 2)
    expect(options.map((option) => option.keys)).toEqual([["2:21"], ["2:30"]])
  })

  it("skips failed instances", () => {
    const options = listAssigneeOptions(
      [{ instanceIndex: 1, ok: false, error: "down" }, results[1]],
      "all"
    )
    expect(options).toHaveLength(2)
  })
})

describe("toggleAssignee", () => {
  it("picks and drops every account of a person", () => {
    const option = { keys: ["1:7", "2:21"] }
    const picked = toggleAssignee(option, new Set(["none"]))
    expect([...picked].sort()).toEqual(["1:7", "2:21", "none"])
    expect(isAssigneeSelected(option, picked)).toBe(true)
    expect([...toggleAssignee(option, picked)]).toEqual(["none"])
  })

  it("drops a person picked on one instance only", () => {
    const option = { keys: ["1:7", "2:21"] }
    expect(toggleAssignee(option, new Set(["2:21"])).size).toBe(0)
  })
})

describe("parseAssigneeParam", () => {
  it("keeps valid keys only", () => {
    expect([...parseAssigneeParam("1:7,none,3:4,abc,2:21")]).toEqual([
      "1:7",
      "none",
      "2:21",
    ])
    expect(parseAssigneeParam(null).size).toBe(0)
  })
})

describe("taskAssigneeNames", () => {
  it("names the task's assignees of its own instance", () => {
    const names = assigneeNamesByKey(results)
    const task = kanbanTask({ instanceIndex: 2, assigneeIds: [21, 30, 99] })
    expect(taskAssigneeNames(task, names)).toEqual(["Haingo", "Zoe Rakoto"])
  })
})

describe("projectOptionsFrom", () => {
  it("lists the projects of the selected instances by name", () => {
    const options = projectOptionsFrom(
      [
        { instanceIndex: 2, projectId: 5, name: "Matelec", partnerName: null },
        { instanceIndex: 1, projectId: 8, name: "COGECI", partnerName: null },
      ],
      "all"
    )
    expect(options.map((option) => option.key)).toEqual(["1:8", "2:5"])
    expect(options[0].taskCount).toBeNull()
    expect(projectOptionsFrom([], 1)).toEqual([])
  })
})

describe("matchesTaskSearch by id", () => {
  it("matches #id and a bare id", () => {
    const task = kanbanTask({ taskId: 18486, name: "Daily" })
    expect(matchesTaskSearch(task, "#18486")).toBe(true)
    expect(matchesTaskSearch(task, "18486")).toBe(true)
    expect(matchesTaskSearch(task, "#1848")).toBe(false)
  })
})
