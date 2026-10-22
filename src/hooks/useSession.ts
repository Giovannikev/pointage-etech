import { useCallback, useEffect, useState } from "react"
import type { Session, User } from "@supabase/supabase-js"

import { initialAuthRedirect, subscribeToSession } from "@/services/authService"
import { getSupabaseClient } from "@/services/supabaseClient"

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User }
  /** Signed in from a password reset link: a new password comes first. */
  | { status: "recovery"; user: User; finishRecovery: () => void }
  | { status: "misconfigured"; message: string }

/** Surfaces a missing Supabase configuration before subscribing. */
function readInitialState(): SessionState {
  try {
    getSupabaseClient()
    return { status: "loading" }
  } catch (error) {
    return {
      status: "misconfigured",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function toSessionState(session: Session | null): SessionState {
  return session === null
    ? { status: "signedOut" }
    : { status: "signedIn", user: session.user }
}

export function useSession(): SessionState {
  const [state, setState] = useState(readInitialState)
  /** Opened from a reset link, until the new password is set. */
  const [isRecovering, setIsRecovering] = useState(
    initialAuthRedirect?.kind === "recovery"
  )
  const canSubscribe = state.status !== "misconfigured"

  useEffect(() => {
    if (!canSubscribe) {
      return undefined
    }
    return subscribeToSession((session, event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovering(true)
      } else if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        // A regular sign-in, or leaving: no reset is under way.
        setIsRecovering(false)
      }
      setState(toSessionState(session))
    })
  }, [canSubscribe])

  const finishRecovery = useCallback(() => setIsRecovering(false), [])

  return state.status === "signedIn" && isRecovering
    ? { status: "recovery", user: state.user, finishRecovery }
    : state
}
