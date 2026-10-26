import { describe, expect, it } from "vitest"
import {
  approvedValue,
  containsWholeRef,
  noteToHtml,
  parseTaskTarget,
  readMajorVersion,
} from "./pmoNote.ts"

describe("parseTaskTarget", () => {
  it("reads ids and references", () => {
    expect(parseTaskTarget("#1234")).toEqual({ kind: "id", id: 1234 })
    expect(parseTaskTarget("03-500")).toEqual({ kind: "ref", ref: "03-500" })
    expect(parseTaskTarget("[ENR-010]")).toEqual({
      kind: "ref",
      ref: "ENR-010",
    })
  })

  it("rejects anything else", () => {
    expect(parseTaskTarget("#0")).toBeNull()
    expect(parseTaskTarget("03 500")).toBeNull()
    expect(parseTaskTarget("")).toBeNull()
  })
})

describe("containsWholeRef", () => {
  it("matches the reference as a whole token", () => {
    expect(containsWholeRef("[03-500] Sale order", "03-500")).toBe(true)
    expect(containsWholeRef("[103-500] Sale order", "03-500")).toBe(false)
    expect(containsWholeRef("[03-5001] Sale order", "03-500")).toBe(false)
  })
})

describe("noteToHtml", () => {
  it("keeps paragraphs, line breaks and indentation", () => {
    const note =
      "Ce qui change :\n- Ajout <champ>\n  • si actif\n\nComment tester :\n1. Ouvrir : OK"
    expect(noteToHtml(note)).toBe(
      "<p>Ce qui change :<br>- Ajout &lt;champ&gt;<br>&nbsp;&nbsp;• si actif</p>" +
        "<p>Comment tester :<br>1. Ouvrir : OK</p>"
    )
  })

  it("normalizes Windows line endings", () => {
    expect(noteToHtml("a\r\nb\r\n\r\nc\r\n")).toBe("<p>a<br>b</p><p>c</p>")
  })
})

describe("readMajorVersion", () => {
  it("reads standard and SaaS versions", () => {
    expect(readMajorVersion([17, 0, 0, "final", 0, ""])).toBe(17)
    expect(readMajorVersion(["saas~17", 4, 0, "final", 0, ""])).toBe(17)
    expect(readMajorVersion(null)).toBeNull()
  })
})

describe("approvedValue", () => {
  it("uses kanban_state before Odoo 17 and state after", () => {
    expect(approvedValue(new Set(["kanban_state", "name"]))).toEqual({
      field: "kanban_state",
      value: "done",
    })
    expect(approvedValue(new Set(["state"]))).toEqual({
      field: "state",
      value: "03_approved",
    })
    expect(approvedValue(new Set(["name"]))).toBeNull()
  })
})
