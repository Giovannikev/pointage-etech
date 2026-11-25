import { describe, expect, it } from "vitest"

import type { UserSettings } from "../supabase/functions/_shared/settings.ts"
import { applySettingsUpdate } from "../supabase/functions/user-settings/applySettingsUpdate.ts"

const STORED: UserSettings = {
  github: null,
  odooInstances: [
    {
      index: 2,
      label: "Edoo IT",
      url: "https://www.edoo-it.com",
      db: "edoo",
      login: "me@company.com",
      apiKey: "stored-secret",
    },
  ],
}

function updateWith(changes: Record<string, string>) {
  return {
    github: null,
    odooInstances: [
      {
        index: 2 as const,
        label: "Edoo IT",
        url: "https://www.edoo-it.com",
        db: "edoo",
        login: "me@company.com",
        apiKey: null,
        ...changes,
      },
    ],
  }
}

describe("applySettingsUpdate", () => {
  it("keeps the stored key when the connection doesn't change", async () => {
    const saved = await applySettingsUpdate(STORED, updateWith({}))
    expect(saved.odooInstances[0].apiKey).toBe("stored-secret")
  })

  it.each([
    { url: "https://attacker.example.com" },
    { login: "someone@else.com" },
    { db: "other" },
  ])("asks for the key again when %o changes", async (changes) => {
    await expect(
      applySettingsUpdate(STORED, updateWith(changes))
    ).rejects.toThrow(/API key of Edoo IT again/)
  })
})
