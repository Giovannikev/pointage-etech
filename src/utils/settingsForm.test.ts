import { describe, expect, it } from "vitest"

import type { SettingsView } from "@/types/settings"
import {
  EMPTY_INSTANCE,
  hasSomeInstance,
  toSettingsDraft,
  toSettingsUpdate,
} from "@/utils/settingsForm"

const EDOO_ONLY: SettingsView = {
  github: null,
  odooInstances: [
    {
      index: 2,
      label: "Edoo IT",
      url: "https://www.edoo-it.com",
      db: "",
      login: "me@company.com",
    },
  ],
}

describe("toSettingsUpdate", () => {
  it("keeps one instance alone, whichever it is, without GitHub", () => {
    const update = toSettingsUpdate(toSettingsDraft(EDOO_ONLY))
    expect(update.github).toBeNull()
    expect(update.odooInstances.map((instance) => instance.index)).toEqual([2])
  })

  it("turns GitHub on with a token, and off once disconnected", () => {
    const draft = { ...toSettingsDraft(EDOO_ONLY), githubToken: "ghp_x" }
    expect(toSettingsUpdate(draft).github).toEqual({
      token: "ghp_x",
      authorEmails: [],
    })
    const connected = toSettingsDraft({
      ...EDOO_ONLY,
      github: { login: "me", authorEmails: [] },
    })
    expect(toSettingsUpdate(connected).github).toEqual({
      token: null,
      authorEmails: [],
    })
    expect(
      toSettingsUpdate({ ...connected, hasStoredGithubToken: false }).github
    ).toBeNull()
  })

  it("drops a removed instance, and needs one at least", () => {
    const draft = toSettingsDraft(EDOO_ONLY)
    expect(hasSomeInstance(draft)).toBe(true)
    const emptied = {
      ...draft,
      instances: { ...draft.instances, 2: EMPTY_INSTANCE },
    }
    expect(toSettingsUpdate(emptied).odooInstances).toEqual([])
    expect(hasSomeInstance(emptied)).toBe(false)
  })
})
