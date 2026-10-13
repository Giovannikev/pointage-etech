import { describe, expect, it } from "vitest"

import { kanbanTask } from "@/test/fixtures"
import type { MyTasksInstanceResult } from "@/types/timesheet"
import {
  buildBoard,
  countClosedTasks,
  listProjects,
  matchesTaskSearch,
  splitTaskName,
  type BoardFilters,
} from "@/utils/kanban"

const results: MyTasksInstanceResult[] = [
  {
    instanceIndex: 1,
    ok: true,
    truncated: false,
    stages: [
      {
        instanceIndex: 1,
        stageId: 100,
        name: "En cours",
        sequence: 5,
        folded: false,
      },
      {
        instanceIndex: 1,
        stageId: 101,
        name: "Terminé",
        sequence: 9,
        folded: true,
      },
    ],
    tasks: [
      kanbanTask({
        taskId: 1,
        name: "[01-1] Écran",
        stageId: 100,
        projectName: "COGECI",
      }),
      kanbanTask({ taskId: 2, stageId: 101, stageName: "Terminé" }),
      kanbanTask({ taskId: 3, stageId: 100, status: "done" }),
    ],
  },
  {
    instanceIndex: 2,
    ok: true,
    truncated: false,
    stages: [
      {
        instanceIndex: 2,
        stageId: 100,
        name: "en cours",
        sequence: 2,
        folded: false,
      },
    ],
    tasks: [
      kanbanTask({
        instanceIndex: 2,
        taskId: 4,
        stageId: 100,
        stageName: "en cours",
        projectId: 5,
        projectName: "Enrôlement",
      }),
      kanbanTask({
        instanceIndex: 2,
        taskId: 5,
        stageId: null,
        stageName: null,
        projectId: null,
        projectName: null,
      }),
    ],
  },
  { instanceIndex: 2, ok: false, error: "unreachable" },
]

const filters = (overrides: Partial<BoardFilters> = {}): BoardFilters => ({
  instance: "all",
  showClosed: false,
  query: "",
  projects: new Set(),
  groupBy: "stage",
  ...overrides,
})

const taskIds = (board: ReturnType<typeof buildBoard>) =>
  board.flatMap((column) => column.tasks.map((task) => task.taskId))

describe("splitTaskName", () => {
  it("separates the bracketed reference", () => {
    expect(splitTaskName("[01-501] Export Excel")).toEqual({
      ref: "01-501",
      title: "Export Excel",
    })
  })
  it("keeps names without reference", () => {
    expect(splitTaskName("Support client")).toEqual({
      ref: null,
      title: "Support client",
    })
  })
})

describe("matchesTaskSearch", () => {
  it("ignores case and accents and searches the project too", () => {
    const task = kanbanTask({ name: "[01-1] Écran", projectName: "Matelec" })
    expect(matchesTaskSearch(task, "ecran MATELEC")).toBe(true)
    expect(matchesTaskSearch(task, "facture")).toBe(false)
  })
})

describe("buildBoard by stage", () => {
  it("merges same-name stages across projects and instances", () => {
    const board = buildBoard(results, filters())
    expect(board.map((column) => [column.name, column.tasks.length])).toEqual([
      ["En cours", 2],
      [null, 1],
    ])
  })

  it("hides closed tasks unless asked", () => {
    expect(taskIds(buildBoard(results, filters()))).not.toContain(2)
    expect(taskIds(buildBoard(results, filters()))).not.toContain(3)
    const all = buildBoard(results, filters({ showClosed: true }))
    expect(taskIds(all).sort()).toEqual([1, 2, 3, 4, 5])
    expect(all.find((column) => column.name === "Terminé")?.folded).toBe(true)
  })

  it("filters by instance, project and search", () => {
    expect(taskIds(buildBoard(results, filters({ instance: 2 })))).toEqual([
      4, 5,
    ])
    expect(
      taskIds(
        buildBoard(results, filters({ projects: new Set(["2:5", "none"]) }))
      )
    ).toEqual([4, 5])
    expect(taskIds(buildBoard(results, filters({ query: "ecran" })))).toEqual([
      1,
    ])
  })
})

describe("buildBoard by project", () => {
  it("makes one column per project, without project last", () => {
    const board = buildBoard(results, filters({ groupBy: "project" }))
    expect(
      board.map((column) => [column.key, column.name, column.instanceIndex])
    ).toEqual([
      ["1:10", "COGECI", 1],
      ["2:5", "Enrôlement", 2],
      ["none", null, null],
    ])
  })
})

describe("listProjects and countClosedTasks", () => {
  it("counts the tasks in scope per project", () => {
    const options = listProjects(results, {
      instance: "all",
      showClosed: false,
    })
    expect(options.map((option) => [option.key, option.taskCount])).toEqual([
      ["1:10", 1],
      ["2:5", 1],
      ["none", 1],
    ])
  })
  it("counts the closed tasks of the instance", () => {
    expect(countClosedTasks(results, "all")).toBe(2)
    expect(countClosedTasks(results, 2)).toBe(0)
  })
})
