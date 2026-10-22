import type { AuthChangeEvent, Session } from "@supabase/supabase-js"

import { getSupabaseClient } from "@/services/supabaseClient"

/** Shared by sign-up, password change and password reset. */
export const MIN_PASSWORD_LENGTH = 8

/** What an email link (password reset, sign-up confirmation) brought back. */
export type AuthRedirect =
  { kind: "recovery" } | { kind: "error"; message: string } | null

/**
 * Reads the URL of an email link: "#access_token=…&type=recovery" for a
 * password reset, "#error=…&error_description=…" for an expired or used
 * link. Read once when the app loads, because Supabase clears the URL as
 * it signs the user in.
 */
export function readAuthRedirect(hash: string, search: string): AuthRedirect {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""))
  const query = new URLSearchParams(search)
  const error =
    fragment.get("error_description") ?? query.get("error_description")
  if (error !== null) {
    return { kind: "error", message: error }
  }
  if (fragment.get("type") === "recovery" && fragment.has("access_token")) {
    return { kind: "recovery" }
  }
  return null
}

function captureAuthRedirect(): AuthRedirect {
  if (typeof window === "undefined") {
    return null
  }
  const redirect = readAuthRedirect(
    window.location.hash,
    window.location.search
  )
  if (redirect?.kind === "error") {
    // The error is shown once; the URL goes back to a plain page.
    const { pathname } = window.location
    window.history.replaceState(window.history.state, "", pathname)
  }
  return redirect
}

/** The email link the app was opened from, if any. */
export const initialAuthRedirect: AuthRedirect = captureAuthRedirect()

/** The current password is wrong: the change is refused before Supabase. */
export class WrongPasswordError extends Error {
  constructor() {
    super("The current password is wrong.")
    this.name = "WrongPasswordError"
  }
}

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

/**
 * Emails a password reset link. The link opens Pointage, which then asks
 * for a new password. Supabase answers the same whether the account
 * exists or not, so nobody can probe for addresses.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
    email.trim(),
    { redirectTo: new URL("/", window.location.origin).href }
  )
  if (error !== null) {
    throw new Error(error.message)
  }
}

/** Sets a new password for the signed-in user (e.g. after a reset link). */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({ password })
  if (error !== null) {
    throw new Error(error.message)
  }
}

/**
 * Changes the password after checking the current one, so an unattended
 * open session isn't enough to take over the account.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const client = getSupabaseClient()
  const { data, error } = await client.auth.getUser()
  const email = data.user?.email
  if (error !== null || email === undefined) {
    throw new Error(error?.message ?? "No signed-in user.")
  }
  const check = await client.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (check.error !== null) {
    throw new WrongPasswordError()
  }
  await updatePassword(newPassword)
}

/** Calls the listener with the current session, then on every change. */
export function subscribeToSession(
  listener: (session: Session | null, event: AuthChangeEvent) => void
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(
    (event, session) => listener(session, event)
  )
  return () => data.subscription.unsubscribe()
}
