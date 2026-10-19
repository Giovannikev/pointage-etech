import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { toLanguage } from "@/i18n"
import type { CommitPeriod } from "@/types/timesheet"
import {
  formatLongDate,
  formatMediumDate,
  formatShortDate,
  formatTime,
} from "@/utils/date"
import { formatHours } from "@/utils/format"
import { formatMonth, formatPeriod } from "@/utils/period"

/** Date and number formatters bound to the current interface language. */
export function useFormatters() {
  const { i18n } = useTranslation()
  const language = toLanguage(i18n.resolvedLanguage)

  return useMemo(
    () => ({
      language,
      formatHours: (hours: number) => formatHours(hours, language),
      formatLongDate: (isoDate: string) => formatLongDate(isoDate, language),
      formatMediumDate: (isoDate: string) =>
        formatMediumDate(isoDate, language),
      formatShortDate: (isoDate: string) => formatShortDate(isoDate, language),
      /** "14:32" for an ISO timestamp, in the browser's time zone. */
      formatTime: (timestamp: string) => formatTime(timestamp, language),
      formatMonth: (month: string) => formatMonth(month, language),
      formatPeriod: (period: CommitPeriod) => formatPeriod(period, language),
    }),
    [language]
  )
}
