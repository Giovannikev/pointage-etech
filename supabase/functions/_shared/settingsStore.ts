import { getAdminClient } from "./auth.ts"
import { decryptText, encryptText } from "./crypto.ts"
import { HttpError } from "./errors.ts"
import {
  EMPTY_SETTINGS,
  parseStoredSettings,
  type UserSettings,
} from "./settings.ts"
import { isRecord } from "./validation.ts"

const TABLE = "user_settings"

export async function loadSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await getAdminClient()
    .from(TABLE)
    .select("payload")
    .eq("user_id", userId)
    .maybeSingle()
  if (error !== null) {
    throw new HttpError(`Couldn't load your settings: ${error.message}`, 500)
  }
  if (data === null) {
    return EMPTY_SETTINGS
  }
  if (!isRecord(data) || typeof data.payload !== "string") {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    )
  }
  const plainText = await decryptText(data.payload, userId)
  return parseStoredSettings(JSON.parse(plainText))
}

export async function saveSettings(
  userId: string,
  settings: UserSettings
): Promise<void> {
  const payload = await encryptText(JSON.stringify(settings), userId)
  const { error } = await getAdminClient()
    .from(TABLE)
    .upsert({ user_id: userId, payload, updated_at: new Date().toISOString() })
  if (error !== null) {
    throw new HttpError(`Couldn't save your settings: ${error.message}`, 500)
  }
}
