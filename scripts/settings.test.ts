import { describe, expect, it } from "vitest"

import {
  isPublicHttpsOrigin,
  parseSettingsUpdate,
} from "../supabase/functions/_shared/settings.ts"

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

describe("isPublicHttpsOrigin", () => {
  it.each([
    "https://www.edoo-it.com",
    "https://pmo-buodoo.arkeup.com",
    "https://8.8.8.8",
  ])("accepts %s", (origin) => {
    expect(isPublicHttpsOrigin(origin)).toBe(true)
  })

  it.each([
    "http://www.edoo-it.com",
    "https://localhost",
    "https://odoo.local",
    "https://127.0.0.1",
    "https://10.0.0.5",
    "https://172.20.1.1",
    "https://192.168.1.10",
    "https://169.254.169.254",
    "https://[::1]",
  ])("refuses %s", (origin) => {
    expect(isPublicHttpsOrigin(origin)).toBe(false)
  })

  it("refuses an http instance when saving", () => {
    expect(() =>
      parseSettingsUpdate({
        github: null,
        odooInstances: [{ ...EDOO, url: "http://www.edoo-it.com" }],
      })
    ).toThrow(/https/)
  })
})
