/**
 * When the auto-attendance cron has something to do: pure functions of the
 * user's preferences and the time, kept apart so they can be tested.
 */
import {
  localMoment,
  type Minute,
  type WorkSchedule,
} from "./attendancePlan.ts"

/** A punch that failed is retried by the next runs for this long. */
export const CATCH_UP_MINUTES = 30
/** A routine missed (Odoo down, no run) is still logged this long after. */
export const ROUTINE_CATCH_UP_MINUTES = 120

export interface PunchTiming {
  timezone: string
  schedule: WorkSchedule
  remoteAfternoonEnd: Minute | null
  randomWindow: number
  nextPunchAt: Date | null
}

export interface RoutineTiming {
  timezone: string
  logAt: Minute
  lastLoggedOn: string | null
}

/** True when the run can't have a punch to make: no Odoo call then. */
export function outsideWorkingHours(
  preference: PunchTiming,
  now: Date
): boolean {
  const local = localMoment(now, preference.timezone)
  if (local === null || local.weekday > 5) return true
  const { morning, afternoon } = preference.schedule
  // Time off only removes work: every punch falls within the schedule.
  const dayEnd = Math.max(afternoon[1], preference.remoteAfternoonEnd ?? 0)
  return (
    local.minute < morning[0] ||
    local.minute > dayEnd + preference.randomWindow + CATCH_UP_MINUTES
  )
}

/**
 * True when Odoo can wait: off the quarter hours (where time off starts and
 * ends), before the next punch found at the last read.
 */
export function nothingDue(preference: PunchTiming, now: Date): boolean {
  const local = localMoment(now, preference.timezone)
  if (local === null || local.minute % 15 === 0) return false
  const next = preference.nextPunchAt
  return next === null || next.getTime() > now.getTime()
}

/** The local day the routine is due on at `now`, or null when it isn't. */
export function routineDueOn(routine: RoutineTiming, now: Date): string | null {
  const local = localMoment(now, routine.timezone)
  if (
    local === null ||
    local.weekday > 5 ||
    local.minute < routine.logAt ||
    local.minute > routine.logAt + ROUTINE_CATCH_UP_MINUTES ||
    routine.lastLoggedOn === local.date
  ) {
    return null
  }
  return local.date
}
