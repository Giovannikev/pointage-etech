const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Today's date in the browser's local time zone, as YYYY-MM-DD. */
export function todayIsoDate(): string {
  return toIsoDate(new Date())
}

/** Local midnight at the start of an ISO date. */
export function startOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/** Last local millisecond of an ISO date. */
export function endOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999`)
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false
  }
  const parsed = startOfDay(value)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getDate() === Number(value.slice(8))
  )
}

export function addDays(isoDate: string, days: number): string {
  const date = startOfDay(isoDate)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/** Number of calendar days from `from` to `to`, both included. */
export function countDays(from: string, to: string): number {
  const elapsed = startOfDay(to).getTime() - startOfDay(from).getTime()
  // Rounding absorbs the 23 and 25 hour days of daylight saving changes.
  return Math.round(elapsed / MS_PER_DAY) + 1
}

/** Formats an ISO date for display, e.g. "Friday, October 9" in English. */
export function formatLongDate(isoDate: string, locale: string): string {
  return startOfDay(isoDate).toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

/** Formats an ISO date compactly, e.g. "Fri, Oct 9" in English. */
export function formatShortDate(isoDate: string, locale: string): string {
  return startOfDay(isoDate).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

/** Formats an ISO date with its year, e.g. "Sep 1, 2026" in English. */
export function formatMediumDate(isoDate: string, locale: string): string {
  return startOfDay(isoDate).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Local calendar day of an Odoo date ("2026-10-15") or of a UTC timestamp
 * ("2026-10-14T21:00:00Z" is the 15th in Madagascar, UTC+3).
 */
export function toLocalIsoDate(value: string): string {
  if (ISO_DATE.test(value)) {
    return value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : toIsoDate(parsed)
}
