import { HttpError } from "./errors.ts"

export function readEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim()
  return value === undefined || value === "" ? null : value
}

export function requireEnv(name: string): string {
  const value = readEnv(name)
  if (value === null) {
    throw new HttpError(`Server misconfigured: ${name} is not set.`, 500)
  }
  return value
}
