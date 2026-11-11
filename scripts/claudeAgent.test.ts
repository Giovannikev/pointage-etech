import { describe, expect, it } from "vitest"

import {
  DEFAULT_CONFIG,
  JOB_TTL_MS,
  claudeArgs,
  expandHome,
  isJobExpired,
  parseConfig,
  readBackgroundId,
  resolveJobFolder,
  sessionName,
  worktreeName,
  type ClaudeJob,
} from "./claudeAgentCore.ts"

const job = (overrides: Partial<ClaudeJob> = {}): ClaudeJob => ({
  id: "1a2b3c4d-0000-0000-0000-000000000000",
  instance_index: 1,
  task_id: 42,
  task_name: "[03-500] Export des factures",
  project_id: 7,
  project_name: "COGECI",
  prompt: "Implement it.",
  status: "pending",
  created_at: "2026-11-11T10:00:00Z",
  ...overrides,
})

describe("parseConfig", () => {
  it("fills in what the file leaves out", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG)
  })
  it("reads the projects and drops empty folders", () => {
    const config = parseConfig({
      permissionMode: "auto",
      worktree: false,
      projects: { COGECI: " ~/repos/cogeci ", Other: "" },
      defaultFolder: "~/repos",
    })
    expect(config).toEqual({
      permissionMode: "auto",
      worktree: false,
      projects: { COGECI: "~/repos/cogeci" },
      defaultFolder: "~/repos",
    })
  })
  it("refuses bypassing the permissions", () => {
    expect(() => parseConfig({ permissionMode: "bypassPermissions" })).toThrow(
      /permissionMode/
    )
  })
  it("refuses a folder that isn't a string", () => {
    expect(() => parseConfig({ projects: { COGECI: 3 } })).toThrow(/COGECI/)
  })
})

describe("expandHome", () => {
  it("expands ~", () => {
    expect(expandHome("~/repos/x", "/home/me")).toBe("/home/me/repos/x")
    expect(expandHome("~", "/home/me")).toBe("/home/me")
    expect(expandHome("/srv/x", "/home/me")).toBe("/srv/x")
  })
})

describe("resolveJobFolder", () => {
  const config = parseConfig({
    projects: { cogeci: "~/repos/cogeci", "2:9": "/srv/nine" },
  })
  it("finds the project by name, whatever the case", () => {
    expect(resolveJobFolder(config, job(), "/home/me")).toEqual({
      ok: true,
      folder: "/home/me/repos/cogeci",
    })
  })
  it("finds the project by instance and id", () => {
    expect(
      resolveJobFolder(
        config,
        job({ instance_index: 2, project_id: 9, project_name: "Nine" }),
        "/home/me"
      )
    ).toEqual({ ok: true, folder: "/srv/nine" })
  })
  it("refuses an unknown project without a default folder", () => {
    const result = resolveJobFolder(config, job({ project_name: "Other" }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/"Other"/)
  })
  it("falls back to the default folder", () => {
    const withDefault = { ...config, defaultFolder: "~/repos" }
    expect(
      resolveJobFolder(withDefault, job({ project_name: "Other" }), "/home/me")
    ).toEqual({ ok: true, folder: "/home/me/repos" })
  })
  it("refuses a relative folder", () => {
    const relative = parseConfig({ projects: { COGECI: "repos/cogeci" } })
    expect(resolveJobFolder(relative, job()).ok).toBe(false)
  })
})

describe("isJobExpired", () => {
  const created = Date.parse("2026-11-11T10:00:00Z")
  it("keeps a recent job", () => {
    expect(isJobExpired(job(), created + JOB_TTL_MS - 1)).toBe(false)
  })
  it("drops an old job", () => {
    expect(isJobExpired(job(), created + JOB_TTL_MS + 1)).toBe(true)
  })
})

describe("names", () => {
  it("names the session after the task", () => {
    expect(sessionName(job())).toBe("Pointage · [03-500] Export des factures")
    expect(sessionName(job({ task_name: "x".repeat(200) }))).toHaveLength(80)
  })
  it("names the worktree after the reference", () => {
    expect(worktreeName(job())).toBe("pointage-03-500-1a2b3c")
    expect(worktreeName(job({ task_name: "No reference" }))).toBe(
      "pointage-42-1a2b3c"
    )
  })
})

describe("claudeArgs", () => {
  it("starts a background session with Remote Control, the prompt last", () => {
    const args = claudeArgs(DEFAULT_CONFIG, job({ prompt: "-p oops" }))
    expect(args.slice(0, 3)).toEqual([
      "--bg",
      "--remote-control",
      "Pointage · [03-500] Export des factures",
    ])
    expect(args).toContain("--worktree")
    expect(args.slice(-2)).toEqual(["--", "-p oops"])
  })
  it("leaves the worktree out when asked", () => {
    expect(
      claudeArgs({ ...DEFAULT_CONFIG, worktree: false }, job())
    ).not.toContain("--worktree")
  })
})

describe("readBackgroundId", () => {
  it("reads the id claude prints", () => {
    const output =
      "Starting background service…\n\u001b[1mbackgrounded · afcf92e9 · name\u001b[0m\n"
    expect(readBackgroundId(output)).toBe("afcf92e9")
  })
  it("is null without one", () => {
    expect(readBackgroundId("Workspace not trusted.")).toBeNull()
  })
})
