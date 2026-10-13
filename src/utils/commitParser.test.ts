import { describe, expect, it } from "vitest"

import { parseCommitLog, parseCommitMessage } from "@/utils/commitParser"

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
