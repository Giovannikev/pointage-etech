import { describe, expect, it } from "vitest"

import type { HelpdeskTicket } from "@/types/timesheet"
import {
  isSameMatch,
  isTicketMatch,
  matchKey,
  ticketLabel,
  toTicketMatch,
} from "@/utils/timesheetTarget"

const ticket = (overrides: Partial<HelpdeskTicket> = {}): HelpdeskTicket => ({
  instanceIndex: 1,
  ticketId: 42,
  name: "BFA vente : signature",
  ref: "HT10766",
  stageName: "Recette interne",
  teamName: "Support Matelec",
  priority: 0,
  projectId: 10,
  projectName: "Matelec",
  hoursSpent: 1,
  loggable: true,
  ...overrides,
})

const task = {
  taskId: 42,
  taskName: "[01-308] Seuil",
  projectId: 10,
  projectName: "Matelec",
  instanceIndex: 1 as const,
}

describe("toTicketMatch", () => {
  it("targets the ticket on its team's project", () => {
    const match = toTicketMatch(ticket())
    expect(match).toEqual({
      taskId: 0,
      taskName: "BFA vente : signature",
      projectId: 10,
      projectName: "Matelec",
      instanceIndex: 1,
      ticket: { ticketId: 42, ref: "HT10766" },
    })
    expect(match !== null && isTicketMatch(match)).toBe(true)
  })

  it("refuses tickets time can't be logged on", () => {
    expect(toTicketMatch(ticket({ loggable: false }))).toBeNull()
    expect(toTicketMatch(ticket({ projectId: null }))).toBeNull()
  })
})

describe("matchKey", () => {
  it("tells a task and a ticket with the same id apart", () => {
    const ticketMatch = toTicketMatch(ticket())!
    expect(isTicketMatch(task)).toBe(false)
    expect(matchKey(task)).toBe("task:1:42")
    expect(matchKey(ticketMatch)).toBe("ticket:1:42")
    expect(isSameMatch(task, ticketMatch)).toBe(false)
  })
})

describe("ticketLabel", () => {
  it("falls back to the id without a reference", () => {
    expect(ticketLabel({ ticketId: 42, ref: null })).toBe("#42")
    expect(ticketLabel({ ticketId: 42, ref: "HT10766" })).toBe("HT10766")
  })
})
