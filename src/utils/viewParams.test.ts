import { describe, expect, it } from "vitest"

import { parseViewHash } from "@/hooks/useHashNavigation"
import {
  buildViewHash,
  formatInstanceParam,
  parseHashParams,
  parseInstanceParam,
} from "@/utils/viewParams"

describe("view hash", () => {
  it("reads the view before the parameters", () => {
    expect(parseViewHash("#kanban")).toBe("kanban")
    expect(parseViewHash("#history?from=2026-10-01")).toBe("history")
    expect(parseViewHash("#/Settings")).toBe("settings")
    expect(parseViewHash("")).toBeNull()
    expect(parseViewHash("#access_token=abc")).toBeNull()
  })

  it("writes only the parameters that have a value", () => {
    expect(
      buildViewHash("kanban", { group: "project", q: "", instance: null })
    ).toBe("#kanban?group=project")
    expect(buildViewHash("history", {})).toBe("#history")
  })

  it("round-trips parameters", () => {
    const hash = buildViewHash("kanban", {
      q: "écran & co",
      projects: "1:2,none",
    })
    const params = parseHashParams(hash)
    expect(params.get("q")).toBe("écran & co")
    expect(params.get("projects")).toBe("1:2,none")
  })

  it("parses the instance filter", () => {
    expect(parseInstanceParam("2")).toBe(2)
    expect(parseInstanceParam("7")).toBe("all")
    expect(formatInstanceParam("all")).toBeNull()
    expect(formatInstanceParam(1)).toBe("1")
  })
})
