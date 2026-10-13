import { getSupabaseClient } from "@/services/supabaseClient"
import { isRecord } from "@/utils/guards"

/**
 * Daily reminder preferences, read and written straight from the browser:
 * nothing in them is secret, and RLS limits each user to their own row
 * (supabase/migrations/20261014000000_reminder_preferences.sql).
 */

const TABLE = "reminder_preferences"

export type ReminderLanguage = "fr" | "en"

export interface ReminderPreferences {
  enabled: boolean
  /** Local hour (0-23) from which the day is checked. */
  remindHour: number
  /** IANA time zone, e.g. "Indian/Antananarivo". */
  timezone: string
  language: ReminderLanguage
}

export const DEFAULT_REMIND_HOUR = 17

/** The browser's time zone, with Madagascar as the fallback. */
export function detectTimezone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Indian/Antananarivo"
    )
  } catch {
    return "Indian/Antananarivo"
  }
}

async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  const userId = data.session?.user.id
  if (error !== null || userId === undefined) {
    throw new Error("Your session has expired. Sign in again.")
  }
  return userId
}

/** The saved preferences, or null when the user never saved any. */
export async function fetchReminderPreferences(): Promise<ReminderPreferences | null> {
  const userId = await requireUserId()
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select("enabled, remind_hour, timezone, language")
    .eq("user_id", userId)
    .maybeSingle()
  if (error !== null) {
    throw new Error(error.message)
  }
  if (data === null) {
    return null
  }
  const row: unknown = data
  if (
    !isRecord(row) ||
    typeof row.enabled !== "boolean" ||
    typeof row.remind_hour !== "number" ||
    typeof row.timezone !== "string"
  ) {
    throw new Error("The reminder preferences are unreadable.")
  }
  return {
    enabled: row.enabled,
    remindHour: row.remind_hour,
    timezone: row.timezone,
    language: row.language === "en" ? "en" : "fr",
  }
}

export async function saveReminderPreferences(
  preferences: ReminderPreferences
): Promise<void> {
  const userId = await requireUserId()
  const { error } = await getSupabaseClient().from(TABLE).upsert(
    {
      user_id: userId,
      enabled: preferences.enabled,
      remind_hour: preferences.remindHour,
      timezone: preferences.timezone,
      language: preferences.language,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  if (error !== null) {
    throw new Error(error.message)
  }
}
