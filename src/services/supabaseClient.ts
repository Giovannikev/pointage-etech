import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseConfig } from "@/lib/env"

let client: SupabaseClient | null = null

/** Lazily creates the Supabase client so a missing config surfaces as a handled error. */
export function getSupabaseClient(): SupabaseClient {
  if (client === null) {
    const { url, anonKey } = getSupabaseConfig()
    client = createClient(url, anonKey)
  }
  return client
}
