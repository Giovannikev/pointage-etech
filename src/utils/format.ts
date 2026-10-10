/** Formats an hour amount for the locale, e.g. 1.5 -> "1.5 h" in English, "1,5 h" in French. */
export function formatHours(hours: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hours)} h`
}
