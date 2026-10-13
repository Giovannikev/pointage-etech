import { HOURS_STEP, MIN_HOURS, WORKDAY_HOURS } from "@/utils/timesheetRules"

/** Shortest and longest time a single commit can account for. */
const MIN_GAP_MINUTES = 15
const MAX_GAP_MINUTES = 180
/** Time given to the day's first commit when nothing else tells. */
const DEFAULT_GAP_MINUTES = 60

/** A timesheet line as seen by the estimate. */
export interface EstimateLine {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** ISO timestamp of the commit; null for pasted commits. */
  authoredAt: string | null
  hours: number
  /** Its hours stay as they are: typed by the user, or already in Odoo. */
  isFixed: boolean
}

function clampGap(minutes: number): number {
  return Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, minutes))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Weight of each line: the time since the previous commit of the day, capped
 * so a lunch break or the night isn't counted. The first commit gets the
 * median gap. Without timestamps every line weighs the same.
 */
export function commitWeights(lines: EstimateLine[]): Map<string, number> {
  const times = lines.map((line) =>
    line.authoredAt === null ? Number.NaN : Date.parse(line.authoredAt)
  )
  if (times.some((time) => Number.isNaN(time))) {
    return new Map(lines.map((line) => [line.id, 1]))
  }

  const ordered = lines
    .map((line, position) => ({ id: line.id, time: times[position] }))
    .sort((a, b) => a.time - b.time)
  const gaps = ordered
    .slice(1)
    .map((line, position) =>
      clampGap((line.time - ordered[position].time) / 60_000)
    )
  const firstGap = gaps.length === 0 ? DEFAULT_GAP_MINUTES : median(gaps)

  return new Map(
    ordered.map((line, position) => [
      line.id,
      position === 0 ? firstGap : gaps[position - 1],
    ])
  )
}

/**
 * Splits `total` hours by weight, in steps of HOURS_STEP, at least MIN_HOURS
 * each. The largest remainders get the leftover steps, so the parts add up.
 */
export function splitHours(
  weights: Map<string, number>,
  total: number
): Map<string, number> {
  const ids = [...weights.keys()]
  if (ids.length === 0) {
    return new Map()
  }
  const steps = Math.max(
    ids.length * (MIN_HOURS / HOURS_STEP),
    Math.round(total / HOURS_STEP)
  )
  const minSteps = MIN_HOURS / HOURS_STEP
  const spare = steps - ids.length * minSteps
  const weightSum = [...weights.values()].reduce((sum, w) => sum + w, 0)

  const shares = ids.map((id) => {
    const exact = (spare * (weights.get(id) ?? 0)) / weightSum
    return { id, base: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let leftover = spare - shares.reduce((sum, share) => sum + share.base, 0)
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder)
  const extra = new Set<string>()
  for (const share of byRemainder) {
    if (leftover <= 0) break
    extra.add(share.id)
    leftover -= 1
  }

  return new Map(
    shares.map((share) => [
      share.id,
      (minSteps + share.base + (extra.has(share.id) ? 1 : 0)) * HOURS_STEP,
    ])
  )
}

/**
 * New hours for the lines that aren't fixed: for each day, the workday minus
 * the fixed lines' hours, split by commit gaps. Days whose fixed lines already
 * fill the workday give each other line the minimum.
 */
export function estimateHours(
  lines: EstimateLine[],
  target = WORKDAY_HOURS
): Map<string, number> {
  const byDate = new Map<string, EstimateLine[]>()
  for (const line of lines) {
    byDate.set(line.date, [...(byDate.get(line.date) ?? []), line])
  }

  const estimates = new Map<string, number>()
  for (const dayLines of byDate.values()) {
    const flexible = dayLines.filter((line) => !line.isFixed)
    if (flexible.length === 0) continue
    const fixedHours = dayLines
      .filter((line) => line.isFixed)
      .reduce((sum, line) => sum + line.hours, 0)
    const remaining = Math.max(0, target - fixedHours)
    for (const [id, hours] of splitHours(commitWeights(flexible), remaining)) {
      estimates.set(id, hours)
    }
  }
  return estimates
}
