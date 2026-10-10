/** Runtime type guards for untrusted data (request bodies, third-party APIs). */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

export function isNonEmptyString(
  value: unknown,
  maxLength: number
): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength
  )
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}
