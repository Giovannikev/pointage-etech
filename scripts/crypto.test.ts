import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, it } from "vitest"

import {
  decryptText,
  encryptText,
} from "../supabase/functions/_shared/crypto.ts"

const env = new Map<string, string>()
Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: (name: string) => env.get(name) } },
  configurable: true,
})

function newKey(): string {
  return randomBytes(32).toString("base64")
}

describe("settings encryption", () => {
  afterEach(() => env.clear())

  it("reads back what it sealed, for the same user only", async () => {
    env.set("CREDENTIALS_ENCRYPTION_KEY", newKey())
    const payload = await encryptText('{"apiKey":"secret"}', "user-1")
    expect(payload).not.toContain("secret")
    await expect(decryptText(payload, "user-1")).resolves.toEqual({
      plainText: '{"apiKey":"secret"}',
      sealedWithPrevious: false,
    })
    await expect(decryptText(payload, "user-2")).rejects.toThrow(
      /can't be decrypted/
    )
  })

  it("reads settings sealed with the previous key during a key change", async () => {
    const oldKey = newKey()
    env.set("CREDENTIALS_ENCRYPTION_KEY", oldKey)
    const payload = await encryptText("settings", "user-1")

    env.set("CREDENTIALS_ENCRYPTION_KEY", newKey())
    await expect(decryptText(payload, "user-1")).rejects.toThrow(
      /can't be decrypted/
    )
    env.set("CREDENTIALS_ENCRYPTION_KEY_PREVIOUS", oldKey)
    await expect(decryptText(payload, "user-1")).resolves.toEqual({
      plainText: "settings",
      sealedWithPrevious: true,
    })
  })

  it("refuses a malformed key", async () => {
    env.set("CREDENTIALS_ENCRYPTION_KEY", "too-short")
    await expect(encryptText("x", "user-1")).rejects.toThrow(/32 bytes/)
  })
})
