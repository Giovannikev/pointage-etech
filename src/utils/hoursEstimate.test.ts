import { describe, expect, it } from "vitest"

import {
  commitWeights,
  estimateHours,
  splitHours,
  type EstimateLine,
} from "@/utils/hoursEstimate"

const line = (overrides: Partial<EstimateLine>): EstimateLine => ({
  id: "a",
  date: "2026-10-12",
  authoredAt: null,
  hours: 1,
  isFixed: false,
  ...overrides,
})

const sum = (map: Map<string, number>) =>
  [...map.values()].reduce((total, hours) => total + hours, 0)

describe("commitWeights", () => {
  it("weighs by time since the previous commit, capped", () => {
    const weights = commitWeights([
      line({ id: "a", authoredAt: "2026-10-12T06:00:00Z" }),
      line({ id: "b", authoredAt: "2026-10-12T07:00:00Z" }),
      line({ id: "c", authoredAt: "2026-10-12T13:00:00Z" }),
    ])
    expect(weights.get("b")).toBe(60)
    // Six hours (lunch, a meeting...) count as three at most.
    expect(weights.get("c")).toBe(180)
    // The first commit gets the median gap.
    expect(weights.get("a")).toBe(120)
  })

  it("weighs equally without timestamps", () => {
    const weights = commitWeights([line({ id: "a" }), line({ id: "b" })])
    expect([...weights.values()]).toEqual([1, 1])
  })
})

describe("splitHours", () => {
  it("splits in quarter hours that add up to the total", () => {
    const parts = splitHours(
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
      8
    )
    expect(sum(parts)).toBe(8)
    for (const hours of parts.values()) {
      expect((hours * 4) % 1).toBe(0)
      expect(hours).toBeGreaterThanOrEqual(2.5)
    }
  })

  it("gives the minimum when nothing is left", () => {
    expect([
      ...splitHours(
        new Map([
          ["a", 1],
          ["b", 3],
        ]),
        0
      ).values(),
    ]).toEqual([0.25, 0.25])
  })
})

describe("estimateHours", () => {
  it("fills the workday around fixed lines, per day", () => {
    const estimates = estimateHours([
      line({ id: "fixed", hours: 3, isFixed: true }),
      line({ id: "a" }),
      line({ id: "b" }),
      line({ id: "other-day", date: "2026-10-13" }),
    ])
    expect(estimates.has("fixed")).toBe(false)
    expect((estimates.get("a") ?? 0) + (estimates.get("b") ?? 0)).toBe(5)
    expect(estimates.get("other-day")).toBe(8)
  })
})
