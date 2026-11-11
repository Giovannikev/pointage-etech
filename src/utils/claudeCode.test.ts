import { describe, expect, it } from "vitest"

import {
  AGENT_ONLINE_MS,
  CLAUDE_PROMPT_MAX_LENGTH,
  JOB_TTL_MS,
  isAgentOnline,
  isJobExpired,
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

describe("isAgentOnline", () => {
  const seen = "2026-11-11T10:00:00Z"
  const at = Date.parse(seen)
  it("is online within three minutes", () => {
    expect(isAgentOnline(seen, at + AGENT_ONLINE_MS)).toBe(true)
  })
  it("is offline past them", () => {
    expect(isAgentOnline(seen, at + AGENT_ONLINE_MS + 1)).toBe(false)
  })
  it("is offline on an unreadable date", () => {
    expect(isAgentOnline("never", at)).toBe(false)
  })
})

describe("isJobExpired", () => {
  const created = "2026-11-11T10:00:00Z"
  const at = Date.parse(created)
  it("waits ten minutes", () => {
    expect(isJobExpired(created, at + JOB_TTL_MS)).toBe(false)
    expect(isJobExpired(created, at + JOB_TTL_MS + 1)).toBe(true)
  })
})
