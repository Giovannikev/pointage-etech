/** Runtime type guards used to validate data coming from the network. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}
