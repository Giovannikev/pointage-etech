/**
 * user-settings — Supabase Edge Function (Deno)
 *
 *   GET  → the signed-in user's settings, without any secret
 *   PUT  → verifies and saves new settings (SettingsUpdate), returns them
 *
 * Settings are encrypted before storage (see _shared/crypto.ts).
 */
import { readJsonBody, serveJson } from "../_shared/http.ts"
import { parseSettingsUpdate, toSettingsView } from "../_shared/settings.ts"
import { loadSettings, saveSettings } from "../_shared/settingsStore.ts"
import { applySettingsUpdate } from "./applySettingsUpdate.ts"

serveJson("user-settings", {
  GET: async ({ userId }) => toSettingsView(await loadSettings(userId)),

  PUT: async ({ request, userId }) => {
    const update = parseSettingsUpdate(await readJsonBody(request))
    const settings = await applySettingsUpdate(
      await loadSettings(userId),
      update
    )
    await saveSettings(userId, settings)
    return toSettingsView(settings)
  },
})
