/**
 * AES-256-GCM encryption of the user settings.
 *
 * The key lives only in the Edge Functions secret CREDENTIALS_ENCRYPTION_KEY
 * (32 random bytes, base64). The user id is bound as additional data, so a
 * ciphertext copied into another user's row can't be decrypted.
 */
import { requireEnv } from "./env.ts"
import { HttpError } from "./errors.ts"

const KEY_ENV = "CREDENTIALS_ENCRYPTION_KEY"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const FORMAT_VERSION = "v1"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * Bytes backed by a plain ArrayBuffer, as Web Crypto expects. The return
 * type is inferred, not written: Uint8Array<ArrayBuffer> on TypeScript 5.7+
 * (Deno 2.2+), plain Uint8Array on older versions such as the dashboard
 * editor's, which reject the generic form.
 */
function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function decodeKey(encoded: string): ReturnType<typeof fromBase64> | null {
  try {
    return fromBase64(encoded)
  } catch {
    return null
  }
}

function importKey(): Promise<CryptoKey> {
  const raw = decodeKey(requireEnv(KEY_ENV))
  if (raw === null || raw.length !== KEY_LENGTH) {
    throw new HttpError(
      `Server misconfigured: ${KEY_ENV} must be ${KEY_LENGTH} bytes encoded in base64.`,
      500
    )
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptText(
  plainText: string,
  associatedData: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
    await importKey(),
    encoder.encode(plainText)
  )
  return [FORMAT_VERSION, toBase64(iv), toBase64(new Uint8Array(cipher))].join(
    "."
  )
}

export async function decryptText(
  payload: string,
  associatedData: string
): Promise<string> {
  const [version, iv, cipher] = payload.split(".")
  if (version !== FORMAT_VERSION || iv === undefined || cipher === undefined) {
    throw new HttpError(
      "Your stored settings are unreadable. Save them again.",
      500
    )
  }
  const key = await importKey()
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(iv),
        additionalData: encoder.encode(associatedData),
      },
      key,
      fromBase64(cipher)
    )
    return decoder.decode(plain)
  } catch {
    throw new HttpError(
      "Your stored settings can't be decrypted. Save them again.",
      500
    )
  }
}
