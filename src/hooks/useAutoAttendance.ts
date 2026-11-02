import { useCallback, useEffect, useState } from "react"

import {
  fetchAutoAttendance,
  saveAutoAttendance,
  type AutoAttendancePreferences,
} from "@/services/autoAttendanceService"

export interface AutoAttendanceState {
  /** Saved settings; null when never saved, undefined while loading. */
  preferences: AutoAttendancePreferences | null | undefined
  error: string | null
  save: (preferences: AutoAttendancePreferences) => Promise<void>
}

/** The automatic attendance settings, shared by the cards of the page. */
export function useAutoAttendance(): AutoAttendanceState {
  const [preferences, setPreferences] = useState<
    AutoAttendancePreferences | null | undefined
  >(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    fetchAutoAttendance().then(
      (loaded) => {
        if (isCurrent) setPreferences(loaded)
      },
      (failure: unknown) => {
        if (isCurrent) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setPreferences(null)
        }
      }
    )
    return () => {
      isCurrent = false
    }
  }, [])

  const save = useCallback(
    async (next: AutoAttendancePreferences): Promise<void> => {
      await saveAutoAttendance(next)
      setPreferences(next)
      setError(null)
    },
    []
  )

  return { preferences, error, save }
}
