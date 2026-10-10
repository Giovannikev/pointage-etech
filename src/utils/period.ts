import type { CommitPeriod } from "@/types/timesheet"
import {
  addDays,
  countDays,
  formatLongDate,
  formatShortDate,
  isIsoDate,
  startOfDay,
  toIsoDate,
  todayIsoDate,
} from "@/utils/date"

/** Longest period accepted by the github-commits Edge Function. */
const MAX_PERIOD_DAYS = 366

const MONTH_VALUE = /^(\d{4})-(\d{2})$/

type PeriodPreset = "today" | "thisWeek" | "lastWeek" | "thisMonth"

/** Order of the shortcuts; their labels are translated under "period.<preset>". */
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "today",
  "thisWeek",
  "lastWeek",
  "thisMonth",
]

export function isPeriodPreset(value: string): value is PeriodPreset {
  return PERIOD_PRESETS.some((preset) => preset === value)
}

/** Monday of the week containing the date. */
function startOfWeek(isoDate: string): string {
  const daysSinceMonday = (startOfDay(isoDate).getDay() + 6) % 7
  return addDays(isoDate, -daysSinceMonday)
}

export function getPresetPeriod(
  preset: PeriodPreset,
  today = todayIsoDate()
): CommitPeriod {
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "thisWeek": {
      const monday = startOfWeek(today)
      return { from: monday, to: addDays(monday, 6) }
    }
    case "lastWeek": {
      const monday = addDays(startOfWeek(today), -7)
      return { from: monday, to: addDays(monday, 6) }
    }
    case "thisMonth": {
      const date = startOfDay(today)
      const first = new Date(date.getFullYear(), date.getMonth(), 1)
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
      return { from: toIsoDate(first), to: toIsoDate(last) }
    }
  }
}

/** Month value ("2026-01") from a year and a zero-based month index. */
export function toMonthValue(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`
}

/** "2026-01" -> "January 2026" in English */
export function formatMonth(month: string, locale: string): string {
  const period = getMonthPeriod(month)
  return period === null
    ? month
    : startOfDay(period.from).toLocaleDateString(locale, {
        month: "long",
        year: "numeric",
      })
}

/** Whole calendar month from a month value ("2026-01"). */
export function getMonthPeriod(month: string): CommitPeriod | null {
  const match = MONTH_VALUE.exec(month)
  if (match === null) {
    return null
  }
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  return {
    from: toIsoDate(new Date(year, monthIndex, 1)),
    to: toIsoDate(new Date(year, monthIndex + 1, 0)),
  }
}

/** The month ("2026-01") the period covers exactly, or "" otherwise. */
export function findMonth(period: CommitPeriod): string {
  const month = period.from.slice(0, 7)
  const whole = getMonthPeriod(month)
  return whole !== null && whole.from === period.from && whole.to === period.to
    ? month
    : ""
}

/** The preset matching the period, or null for a custom period. */
export function findPreset(
  period: CommitPeriod,
  today = todayIsoDate()
): PeriodPreset | null {
  const match = PERIOD_PRESETS.find((preset) => {
    const presetPeriod = getPresetPeriod(preset, today)
    return presetPeriod.from === period.from && presetPeriod.to === period.to
  })
  return match ?? null
}

export function isValidPeriod(period: CommitPeriod): boolean {
  if (!isIsoDate(period.from) || !isIsoDate(period.to)) {
    return false
  }
  const days = countDays(period.from, period.to)
  return days >= 1 && days <= MAX_PERIOD_DAYS
}

/** "Friday, October 9" for a single day, "Mon, Oct 5 – Sun, Oct 11" otherwise (in English). */
export function formatPeriod(period: CommitPeriod, locale: string): string {
  return period.from === period.to
    ? formatLongDate(period.from, locale)
    : `${formatShortDate(period.from, locale)} – ${formatShortDate(period.to, locale)}`
}
