import type {
  KanbanTask,
  TimesheetEntry,
  TimesheetHistoryEntry,
} from "@/types/timesheet"

/** Test data builders: sensible defaults, overridden per test. */

export function kanbanTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    instanceIndex: 1,
    taskId: 1,
    name: "[01-1] Task",
    projectId: 10,
    projectName: "Project",
    stageId: 100,
    stageName: "In progress",
    priority: 0,
    deadline: null,
    status: null,
    plannedHours: null,
    effectiveHours: 0,
    ...overrides,
  }
}

export function historyEntry(
  overrides: Partial<TimesheetHistoryEntry> = {}
): TimesheetHistoryEntry {
  return {
    instanceIndex: 1,
    timesheetId: 1,
    date: "2026-10-12",
    description: "Work",
    hours: 1,
    projectId: 10,
    projectName: "Project",
    taskId: 1,
    taskName: "Task",
    ticketId: null,
    ticketName: null,
    locked: false,
    ...overrides,
  }
}

export function timesheetEntry(
  overrides: Partial<TimesheetEntry> = {}
): TimesheetEntry {
  return {
    id: "line-1",
    commit: {
      rawMessage: "[03-500] add x",
      taskRef: "03-500",
      moduleName: null,
      action: "add",
      rawDescription: "add x",
      frenchSummary: "Ajout de la fonction x",
    },
    description: "Ajout de la fonction x",
    isDescriptionEdited: false,
    hours: 1,
    isHoursEdited: false,
    date: "2026-10-12",
    authoredAt: null,
    status: "found",
    task: {
      taskId: 1,
      taskName: "[03-500] Task",
      projectId: 10,
      projectName: "Project",
      instanceIndex: 1,
    },
    activity: "idle",
    statusDetail: null,
    odooTimesheetId: null,
    odooLocked: false,
    loggedHours: 0,
    ...overrides,
  }
}
