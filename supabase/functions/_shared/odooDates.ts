/** Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS". */
export function readOdooDatetime(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(`${value.replace(" ", "T")}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** An Odoo datetime, "YYYY-MM-DD HH:MM:SS" in UTC, for a domain or a value. */
export function toOdooDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}
