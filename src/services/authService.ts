import type { Session } from "@supabase/supabase-js"

import { getSupabaseClient } from "@/services/supabaseClient"

interface SignUpResult {
  /** True when Supabase requires the email address to be confirmed first. */
  needsConfirmation: boolean
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password,
  })
  if (error !== null) {
    throw new Error(error.message)
  }
}

export async function signUp(
  email: string,
  password: string
): Promise<SignUpResult> {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email,
    password,
  })
  if (error !== null) {
    throw new Error(error.message)
  }
  return { needsConfirmation: data.session === null }
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error !== null) {
    throw new Error(error.message)
  }
}

/** Calls the listener with the current session, then on every change. */
export function subscribeToSession(
  listener: (session: Session | null) => void
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(
    (_event, session) => listener(session)
  )
  return () => data.subscription.unsubscribe()
}
