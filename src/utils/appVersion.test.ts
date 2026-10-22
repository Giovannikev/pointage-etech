import { describe, expect, it, vi } from "vitest"

import {
  fetchDeployedVersion,
  isNewDeployment,
  readVersionFile,
} from "@/utils/appVersion"

const answer = (body: unknown, init: ResponseInit = {}) =>
  vi.fn<typeof fetch>(async () =>
    typeof body === "string"
      ? new Response(body, init)
      : Response.json(body, init)
  )

describe("readVersionFile", () => {
  it("reads the version of version.json", () => {
    expect(readVersionFile({ version: " abc123 ", buildTime: "x" })).toBe(
      "abc123"
    )
  })
  it("refuses anything else", () => {
    for (const content of [null, "abc", {}, { version: 3 }, { version: " " }]) {
      expect(readVersionFile(content)).toBeNull()
    }
  })
})

describe("fetchDeployedVersion", () => {
  it("reads past every cache, with a fresh query each time", async () => {
    const fetchImpl = answer({ version: "abc123" })
    expect(await fetchDeployedVersion(fetchImpl, () => 42)).toBe("abc123")
    expect(fetchImpl).toHaveBeenCalledWith("/version.json?t=42", {
      cache: "no-store",
    })
  })

  it("tells nothing when the check fails", async () => {
    // Missing file, the SPA's index.html instead of JSON, offline.
    expect(await fetchDeployedVersion(answer({}, { status: 404 }))).toBeNull()
    expect(
      await fetchDeployedVersion(answer("<!doctype html><html></html>"))
    ).toBeNull()
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch")
    })
    expect(await fetchDeployedVersion(offline)).toBeNull()
  })
})

describe("isNewDeployment", () => {
  it("is true only for another known version", () => {
    expect(isNewDeployment("a", "b")).toBe(true)
    expect(isNewDeployment("a", "a")).toBe(false)
    // A failed check, or a build without version: never an update.
    expect(isNewDeployment("a", null)).toBe(false)
    expect(isNewDeployment(null, "b")).toBe(false)
  })
})
