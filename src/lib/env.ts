function readRequired(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${name}. Add it to your .env file.`)
  }
  return value.trim()
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  return {
    url: readRequired("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL),
    anonKey: readRequired(
      "VITE_SUPABASE_ANON_KEY",
      import.meta.env.VITE_SUPABASE_ANON_KEY
    ),
  }
}
