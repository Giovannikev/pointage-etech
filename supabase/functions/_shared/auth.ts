import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

import { requireEnv } from "./env.ts"
import { HttpError } from "./errors.ts"

let adminClient: SupabaseClient | null = null

/** Service-role client. It bypasses RLS, so it must never leave the server. */
export function getAdminClient(): SupabaseClient {
  adminClient ??= createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  )
  return adminClient
}

/** Returns the id of the signed-in user who sent the request. */
export async function requireUserId(request: Request): Promise<string> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (token === undefined || token === "") {
    throw new HttpError("Sign in to use Pointage.", 401)
  }
  const { data, error } = await getAdminClient().auth.getUser(token)
  if (error !== null || data.user === null) {
    throw new HttpError("Your session has expired. Sign in again.", 401)
  }
  return data.user.id
}
