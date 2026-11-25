import { useEffect, useRef, useState } from "react"

import type { CommitPeriod } from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import { getPresetPeriod, rollPeriodToToday } from "@/utils/period"

const DAY_CHECK_MS = 60_000

/**
 * A period starting on a preset that follows the day change: checked every
 * minute and when the app comes back into view, since a PWA can stay open
 * (or asleep in the background) overnight.
 */
export function usePresetPeriod(
  initial: Parameters<typeof getPresetPeriod>[0]
): [CommitPeriod, (period: CommitPeriod) => void] {
  const [period, setPeriod] = useState<CommitPeriod>(() =>
    getPresetPeriod(initial)
  )
  const dayRef = useRef(todayIsoDate())

  useEffect(() => {
    const checkDay = (): void => {
      const today = todayIsoDate()
      const previous = dayRef.current
      if (today === previous) {
        return
      }
      dayRef.current = today
      setPeriod((current) => rollPeriodToToday(current, previous, today))
    }
    const timer = window.setInterval(checkDay, DAY_CHECK_MS)
    document.addEventListener("visibilitychange", checkDay)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", checkDay)
    }
  }, [])

  return [period, setPeriod]
}
