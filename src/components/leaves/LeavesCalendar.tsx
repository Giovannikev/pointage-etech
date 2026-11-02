import { useCallback, useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, HourglassIcon } from "lucide-react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { useNow } from "@/hooks/useNow"
import { cn } from "@/lib/utils"
import {
  fetchAttendance,
  fetchTimeOff,
  peekAttendance,
  peekTimeOff,
} from "@/services/odooService"
import type {
  AttendanceInstanceResult,
  LeaveRequest,
  TimeOffInstanceResult,
} from "@/types/timesheet"
import { startOfDay, todayIsoDate } from "@/utils/date"
import {
  formatDuration,
  groupAttendanceByDay,
  holidayDates,
  isActiveRequest,
  leaveKey,
  leaveStateTone,
  monthWeeks,
  workedTimeTypeKeys,
} from "@/utils/leaves"
import { getMonthPeriod, toMonthValue } from "@/utils/period"

type AvailableTimeOff = Extract<TimeOffInstanceResult, { ok: true }>
type AvailableAttendance = Extract<AttendanceInstanceResult, { ok: true }>

const ABSENCE_STYLE = "bg-time-off/15 text-time-off"
const WORKED_STYLE = "bg-remote-work/15 text-remote-work"
const HOLIDAY_STYLE = "bg-warning/15 text-warning"
const PENDING_STYLE = "border border-dashed border-current"
/** A day's chip, from sm: on a phone, days are too narrow for labels. */
const CHIP =
  "truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium max-sm:hidden"

function shiftMonth(month: string, by: number): string {
  const start = startOfDay(`${month}-01`)
  const date = new Date(start.getFullYear(), start.getMonth() + by, 1)
  return toMonthValue(date.getFullYear(), date.getMonth())
}

function LegendItem({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3 rounded-sm", className)} />
      {label}
    </span>
  )
}

interface CalendarDay {
  date: string
  holiday: string | undefined
  requests: LeaveRequest[]
  hours: number | undefined
}

/** The label of a request on a day: its half day, its type. */
function requestLabel(request: LeaveRequest, t: TFunction): string {
  const half =
    request.period === null
      ? ""
      : `${request.period === "am" ? t("leaves.morning") : t("leaves.afternoon")} · `
  return `${half}${request.leaveTypeName}`
}

/**
 * A month of time off, public holidays and attendance hours: a grid with
 * labels from sm; on a phone, a grid of dots and the month's days in a list.
 */
export function LeavesCalendar() {
  const { t } = useTranslation()
  const { formatMonth, formatShortDate, language } = useFormatters()
  const now = useNow()
  const today = todayIsoDate()
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const period = useMemo(
    () => getMonthPeriod(month) ?? { from: today, to: today },
    [month, today]
  )

  const timeOffFetcher = useCallback(
    ({ force }: { force: boolean }) => fetchTimeOff({ force }),
    []
  )
  const timeOff = useCachedQuery("timeOff", timeOffFetcher, peekTimeOff)
  const { from, to } = period
  const attendanceFetcher = useCallback(
    ({ force }: { force: boolean }) => fetchAttendance({ from, to }, { force }),
    [from, to]
  )
  const peek = useCallback(() => peekAttendance({ from, to }), [from, to])
  const attendance = useCachedQuery(
    `attendance:${from}:${to}`,
    attendanceFetcher,
    peek
  )

  const { requests, workedTypes, holidays } = useMemo(() => {
    const results = (timeOff.data ?? []).filter(
      (result): result is AvailableTimeOff => result.ok && result.available
    )
    return {
      requests: results
        .flatMap((result) => result.requests)
        .filter(isActiveRequest),
      workedTypes: workedTimeTypeKeys(
        results.flatMap((result) => result.leaveTypes)
      ),
      holidays: holidayDates(results.flatMap((result) => result.holidays)),
    }
  }, [timeOff.data])
  const hoursByDate = useMemo(() => {
    const attendances = (attendance.data ?? [])
      .filter(
        (result): result is AvailableAttendance => result.ok && result.available
      )
      .flatMap((result) => result.attendances)
    return new Map(
      groupAttendanceByDay(attendances, period, now).map((day) => [
        day.date,
        day.hours,
      ])
    )
  }, [attendance.data, period, now])

  const weeks = monthWeeks(month)
  // Monday to Sunday, in the interface language.
  const weekdays = weeks[0].map((date) =>
    startOfDay(date).toLocaleDateString(language, { weekday: "short" })
  )
  const dayOf = (date: string): CalendarDay => ({
    date,
    holiday: holidays.get(date),
    requests: requests.filter(
      (request) => request.dateFrom <= date && date <= request.dateTo
    ),
    hours: hoursByDate.get(date),
  })
  const isWorked = (request: LeaveRequest) =>
    workedTypes.has(`${request.instanceIndex}:${request.leaveTypeId}`)
  const isPending = (request: LeaveRequest) =>
    leaveStateTone(request.state) === "pending"
  const requestStyle = (request: LeaveRequest) =>
    cn(
      isWorked(request) ? WORKED_STYLE : ABSENCE_STYLE,
      isPending(request) && PENDING_STYLE
    )
  // The phone list: the month's days with something on them.
  const agenda = weeks
    .flat()
    .filter((date) => date.slice(0, 7) === month)
    .map(dayOf)
    .filter(
      (day) =>
        day.holiday !== undefined ||
        day.requests.length > 0 ||
        day.hours !== undefined
    )

  return (
    <section className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold first-letter:uppercase">
          {formatMonth(month)}
        </h3>
        <div className="flex items-center gap-1">
          {month !== today.slice(0, 7) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonth(today.slice(0, 7))}
            >
              {t("leaves.calendar.current")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("leaves.calendar.previous")}
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("leaves.calendar.next")}
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {timeOff.data === undefined && timeOff.error === null ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : (
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border text-xs">
          {weekdays.map((weekday) => (
            <div
              key={weekday}
              className="border-b bg-muted/50 px-1 py-1.5 text-center font-medium text-muted-foreground first-letter:uppercase"
            >
              {weekday}
            </div>
          ))}
          {weeks.flat().map((date, index) => {
            const inMonth = date.slice(0, 7) === month
            const day = dayOf(date)
            const isWeekend = index % 7 >= 5
            return (
              <div
                key={date}
                className={cn(
                  "flex min-h-11 flex-col gap-0.5 border-r border-b p-1 sm:min-h-[4.5rem] sm:p-1.5 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                  !inMonth && "bg-muted/30 text-muted-foreground/60",
                  isWeekend && inMonth && "bg-muted/20"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums max-sm:mx-auto",
                    date === today &&
                      "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {Number(date.slice(8))}
                </span>
                {inMonth && (
                  <>
                    {/* Phone: one dot per item, the labels are in the list below. */}
                    <span className="flex justify-center gap-0.5 sm:hidden">
                      {day.holiday !== undefined && (
                        <span className="size-1.5 rounded-full bg-warning" />
                      )}
                      {day.requests.map((request) => (
                        <span
                          key={leaveKey(request)}
                          className={cn(
                            "size-1.5 rounded-full",
                            isWorked(request)
                              ? "bg-remote-work"
                              : "bg-time-off",
                            isPending(request) && "opacity-50"
                          )}
                        />
                      ))}
                    </span>
                    {day.holiday !== undefined && (
                      <span
                        className={cn(CHIP, HOLIDAY_STYLE)}
                        title={day.holiday}
                      >
                        {day.holiday || t("leaves.calendar.holiday")}
                      </span>
                    )}
                    {day.requests.map((request) => (
                      <span
                        key={leaveKey(request)}
                        className={cn(CHIP, requestStyle(request))}
                        title={[
                          `${request.leaveTypeName} · ${t(`leaves.state.${request.state}`)}`,
                          request.description,
                        ]
                          .filter((line) => line !== "")
                          .join("\n")}
                      >
                        <span className="flex items-center gap-0.5 truncate">
                          {isPending(request) && (
                            <HourglassIcon className="size-2.5 shrink-0" />
                          )}
                          <span className="truncate">
                            {requestLabel(request, t)}
                          </span>
                        </span>
                        {/* The reason given in the request, under its type. */}
                        {request.description !== "" && (
                          <span className="block truncate font-normal opacity-80">
                            {request.description}
                          </span>
                        )}
                      </span>
                    ))}
                    {day.hours !== undefined && (
                      <span className="mt-auto text-right text-[11px] font-semibold tabular-nums max-sm:hidden">
                        {formatDuration(day.hours)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {agenda.length > 0 && (
        <ul className="grid divide-y rounded-lg border sm:hidden">
          {agenda.map((day) => (
            <li key={day.date} className="flex items-start gap-3 px-3 py-2.5">
              <span
                className={cn(
                  "w-20 shrink-0 text-sm font-medium first-letter:uppercase",
                  day.date === today && "text-primary"
                )}
              >
                {formatShortDate(day.date)}
              </span>
              <div className="grid min-w-0 flex-1 gap-1">
                {day.holiday !== undefined && (
                  <span
                    className={cn(
                      "w-fit rounded px-1.5 py-0.5 text-xs font-medium",
                      HOLIDAY_STYLE
                    )}
                  >
                    {day.holiday || t("leaves.calendar.holiday")}
                  </span>
                )}
                {day.requests.map((request) => (
                  <span
                    key={leaveKey(request)}
                    className={cn(
                      "grid w-fit max-w-full rounded px-1.5 py-0.5 text-xs font-medium",
                      requestStyle(request)
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {isPending(request) && (
                        <HourglassIcon className="size-3 shrink-0" />
                      )}
                      <span className="truncate">
                        {requestLabel(request, t)}
                      </span>
                    </span>
                    {request.description !== "" && (
                      <span className="truncate font-normal opacity-80">
                        {request.description}
                      </span>
                    )}
                  </span>
                ))}
              </div>
              {day.hours !== undefined && (
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatDuration(day.hours)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <LegendItem
          className="bg-time-off"
          label={t("leaves.calendar.legendLeave")}
        />
        <LegendItem
          className="bg-remote-work"
          label={t("leaves.calendar.legendRemote")}
        />
        <LegendItem
          className="bg-warning"
          label={t("leaves.calendar.legendHoliday")}
        />
        <span className="flex items-center gap-1.5">
          <HourglassIcon className="size-3" />
          {t("leaves.calendar.legendPending")}
        </span>
      </div>
    </section>
  )
}
