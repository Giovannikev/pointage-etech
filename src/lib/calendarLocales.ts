import type { Locale } from "react-day-picker"
import { enUS, fr } from "react-day-picker/locale"

import type { Language } from "@/i18n"

/** Month and weekday names of the calendar, per interface language. */
export const CALENDAR_LOCALES: Readonly<Record<Language, Locale>> = {
  en: enUS,
  fr,
}
