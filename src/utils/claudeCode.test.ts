import { describe, expect, it } from "vitest"

import {
  CLAUDE_PROMPT_MAX_LENGTH,
  buildClaudeCodeUrl,
  truncateText,
} from "@/utils/claudeCode"

describe("buildClaudeCodeUrl", () => {
  it("carries the prompt and the folder", () => {
    const url = new URL(
      buildClaudeCodeUrl("Implement [03-500] & test", " ~/repos/odoo ")
    )
    expect(url.protocol).toBe("claude:")
    expect(url.host).toBe("code")
    expect(url.pathname).toBe("/new")
    expect(url.searchParams.get("q")).toBe("Implement [03-500] & test")
    expect(url.searchParams.get("folder")).toBe("~/repos/odoo")
  })
  it("leaves out an empty folder", () => {
    const url = new URL(buildClaudeCodeUrl("Do it", ""))
    expect(url.searchParams.has("folder")).toBe(false)
  })
  it("opens an empty session without anything", () => {
    expect(buildClaudeCodeUrl(" ", "")).toBe("claude://code/new")
  })
  it("cuts a prompt Claude Desktop would refuse", () => {
    const url = new URL(buildClaudeCodeUrl("a".repeat(20_000), ""))
    expect(url.searchParams.get("q")).toHaveLength(CLAUDE_PROMPT_MAX_LENGTH)
  })
})

describe("truncateText", () => {
  it("keeps a short text", () => {
    expect(truncateText("short", 10)).toBe("short")
  })
  it("ends a cut text with an ellipsis", () => {
    expect(truncateText("a long text", 7)).toBe("a long…")
  })
})
