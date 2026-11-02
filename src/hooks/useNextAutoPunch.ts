import { useEffect, useState } from "react"

import {
  fetchAutoAttendance,
  fetchAutoAttendancePlan,
  type PlannedPunch,
} from "@/services/autoAttendanceService"

/** Local "HH:MM" of a date. */
function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/**
 * Today's next automatic punch, when automatic attendance is on; null
 * otherwise or once the day's punches are done. Read once per app load:
 * the plan reads Odoo.
 */
export function useNextAutoPunch(now: Date): PlannedPunch | null {
  const [punches, setPunches] = useState<PlannedPunch[]>([])

  useEffect(() => {
    let isCurrent = true
    fetchAutoAttendance()
      .then((preferences) =>
        preferences?.enabled === true ? fetchAutoAttendancePlan() : null
      )
      .then(
        (plan) => {
          if (isCurrent && plan !== null && plan.workingDay) {
            setPunches(plan.punches)
          }
        },
        // The header stays quiet: the attendance page shows the errors.
        () => undefined
      )
    return () => {
      isCurrent = false
    }
  }, [])

  const clock = clockOf(now)
  return punches.find((punch) => punch.time > clock) ?? null
}
