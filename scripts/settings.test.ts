import { describe, expect, it } from "vitest"

import { parseSettingsUpdate } from "../supabase/functions/_shared/settings.ts"

const EDOO = {
  index: 2,
  label: "Edoo IT",
  url: "https://www.edoo-it.com/odoo/action-224",
  db: "",
  login: "me@company.com",
  apiKey: "secret",
}

describe("parseSettingsUpdate", () => {
  it("accepts instance 2 alone and no GitHub", () => {
    const update = parseSettingsUpdate({ github: null, odooInstances: [EDOO] })
    expect(update.github).toBeNull()
    expect(update.odooInstances).toEqual([
      { ...EDOO, url: "https://www.edoo-it.com" },
    ])
  })

  it("still needs one Odoo instance", () => {
    expect(() =>
      parseSettingsUpdate({ github: null, odooInstances: [] })
    ).toThrow(/between 1 and 2/)
  })

  it("rejects a body without the GitHub field", () => {
    expect(() => parseSettingsUpdate({ odooInstances: [EDOO] })).toThrow()
  })
})
