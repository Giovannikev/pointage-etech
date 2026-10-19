import { describe, expect, it } from "vitest"

import {
  parseCommitLog,
  parseCommitMessage,
  parsePastedCommits,
} from "@/utils/commitParser"

describe("parseCommitMessage", () => {
  it("reads the reference, module and action", () => {
    expect(
      parseCommitMessage("[03-500] matelec_sale: add french translations")
    ).toMatchObject({
      taskRef: "03-500",
      moduleName: "matelec_sale",
      action: "add",
      rawDescription: "add french translations",
    })
  })

  it("skips Odoo tags and short hashes", () => {
    expect(
      parseCommitMessage("[FIX] [03-512] matelec_stock: fix rounding")
    ).toMatchObject({
      taskRef: "03-512",
      action: "fix",
    })
    expect(
      parseCommitMessage("a1b2c3d [03-498] update access rights")
    ).toMatchObject({
      taskRef: "03-498",
      action: "update",
    })
  })

  it("ignores merge commits and keeps messages without reference", () => {
    expect(parseCommitMessage("Merge branch 'main' into dev")).toBeNull()
    expect(parseCommitMessage("wip")?.taskRef).toBeNull()
  })
})

describe("parseCommitLog", () => {
  it("parses one commit per line, skipping merges and blanks", () => {
    expect(
      parseCommitLog(
        "[03-500] a: add x\n\nMerge pull request #3\n[03-501] b: fix y"
      )
    ).toHaveLength(2)
  })
})

describe("parsePastedCommits", () => {
  const DAY = "2026-10-19"

  it("reads a time pasted before the message, on the picked day", () => {
    const [commit] = parsePastedCommits("14:32 [03-500] a: add x", DAY)
    expect(commit.authoredAt).toBe("2026-10-19T11:32:00.000Z")
    expect(commit.commit.rawMessage).toBe("[03-500] a: add x")
    expect(commit.commit.taskRef).toBe("03-500")
  })

  it("reads a time after the short hash, with seconds", () => {
    const [commit] = parsePastedCommits("a1b2c3d 09:05:30 [03-498] fix y", DAY)
    expect(commit.authoredAt).toBe("2026-10-19T06:05:30.000Z")
    expect(commit.commit.taskRef).toBe("03-498")
  })

  it("keeps the offset of an ISO timestamp", () => {
    const [iso, strict] = parsePastedCommits(
      [
        "2026-10-18 16:05:00 +0200 [03-1] add a",
        "2026-10-18T16:05:00+02:00 [03-2] add b",
      ].join("\n"),
      DAY
    )
    expect(iso.authoredAt).toBe("2026-10-18T14:05:00.000Z")
    expect(strict.authoredAt).toBe("2026-10-18T14:05:00.000Z")
  })

  it("reads the Date line of the default git log format", () => {
    const [commit] = parsePastedCommits(
      [
        "commit 0123456789abcdef0123456789abcdef01234567",
        "Author: Dev <dev@example.com>",
        "Date:   Mon Oct 19 14:32:10 2026 +0300",
        "",
        "    [03-500] matelec_sale: add x",
      ].join("\n"),
      DAY
    )
    expect(commit.authoredAt).toBe("2026-10-19T11:32:10.000Z")
    expect(commit.commit.taskRef).toBe("03-500")
  })

  it("leaves untimed commits and impossible times without a time", () => {
    const commits = parsePastedCommits(
      "[03-500] add x\n25:61 [03-501] add y",
      DAY
    )
    expect(commits.map((commit) => commit.authoredAt)).toEqual([null, null])
  })
})
