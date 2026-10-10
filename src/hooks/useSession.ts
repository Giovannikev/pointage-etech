import { useEffect, useState } from "react"
import type { Session, User } from "@supabase/supabase-js"

import { subscribeToSession } from "@/services/authService"
import { getSupabaseClient } from "@/services/supabaseClient"

type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User }
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
  const canSubscribe = state.status !== "misconfigured"

  useEffect(() => {
    if (!canSubscribe) {
      return undefined
    }
    return subscribeToSession((session) => setState(toSessionState(session)))
  }, [canSubscribe])

  return state
}
