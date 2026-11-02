import { useCallback, useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
/** A day's chip: a label, or a thin bar on a phone, where days are narrow. */
const CHIP =
  "truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium max-sm:h-1.5 max-sm:bg-current max-sm:p-0 max-sm:text-[0px]"

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

/** A month of time off, public holidays and attendance hours. */
export function LeavesCalendar() {
  const { t } = useTranslation()
  const { formatMonth, language } = useFormatters()
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
  const requestsOn = (date: string): LeaveRequest[] =>
    requests.filter(
      (request) => request.dateFrom <= date && date <= request.dateTo
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("leaves.calendar.title")}</CardTitle>
        <CardDescription>{t("leaves.calendar.subtitle")}</CardDescription>
        <CardAction className="flex items-center gap-1">
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
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold first-letter:uppercase">
            {formatMonth(month)}
          </h3>
          {month !== today.slice(0, 7) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonth(today.slice(0, 7))}
            >
              {t("leaves.calendar.current")}
            </Button>
          )}
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
              const holiday = holidays.get(date)
              const hours = hoursByDate.get(date)
              const dayRequests = requestsOn(date)
              const isWeekend = index % 7 >= 5
              return (
                <div
                  key={date}
                  className={cn(
                    "flex min-h-14 flex-col gap-0.5 border-r border-b p-1 sm:min-h-[4.5rem] sm:p-1.5 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                    !inMonth && "bg-muted/30 text-muted-foreground/60",
                    isWeekend && inMonth && "bg-muted/20"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums",
                      date === today &&
                        "bg-primary font-semibold text-primary-foreground"
                    )}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {inMonth && holiday !== undefined && (
                    <span className={cn(CHIP, HOLIDAY_STYLE)} title={holiday}>
                      {holiday || t("leaves.calendar.holiday")}
                    </span>
                  )}
                  {inMonth &&
                    dayRequests.map((request) => {
                      const worked = workedTypes.has(
                        `${request.instanceIndex}:${request.leaveTypeId}`
                      )
                      const pending =
                        leaveStateTone(request.state) === "pending"
                      return (
                        <span
                          key={leaveKey(request)}
                          className={cn(
                            CHIP,
                            worked ? WORKED_STYLE : ABSENCE_STYLE,
                            pending && PENDING_STYLE
                          )}
                          title={`${request.leaveTypeName} · ${t(`leaves.state.${request.state}`)}`}
                        >
                          {request.period !== null
                            ? `${request.period === "am" ? t("leaves.morning") : t("leaves.afternoon")} · `
                            : ""}
                          {request.leaveTypeName}
                        </span>
                      )
                    })}
                  {inMonth && hours !== undefined && (
                    <span className="mt-auto text-right text-[11px] font-semibold tabular-nums max-sm:text-[10px]">
                      {formatDuration(hours)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
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
          <LegendItem
            className={cn("text-muted-foreground", PENDING_STYLE)}
            label={t("leaves.calendar.legendPending")}
          />
        </div>
      </CardContent>
    </Card>
  )
}
