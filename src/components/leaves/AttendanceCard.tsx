import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2Icon, LogInIcon, LogOutIcon, RefreshCwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CommitPeriodPicker } from "@/components/timesheet/CommitPeriodPicker"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { InstanceErrorNotice } from "@/components/timesheet/InstanceErrorNotice"
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
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import {
  checkInOut,
  fetchAttendance,
  peekAttendance,
} from "@/services/odooService"
import type {
  AttendanceInstanceResult,
  CommitPeriod,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { groupAttendanceByDay } from "@/utils/leaves"
import { getPresetPeriod, isValidPeriod } from "@/utils/period"

type AvailableAttendance = Extract<AttendanceInstanceResult, { ok: true }>

/** Re-renders every minute, so the time since check-in keeps running. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function CheckInStatus({
  result,
  showInstance,
  now,
  onChanged,
}: {
  result: AvailableAttendance
  showInstance: boolean
  now: Date
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { formatTime, formatHours } = useFormatters()
  const instances = useOdooInstances()
  const [isSaving, setIsSaving] = useState(false)
  const odooUrl = instances.find(
    (instance) => instance.index === result.instanceIndex
  )?.url

  const isIn = result.openSince !== null
  const elapsed =
    result.openSince === null
      ? 0
      : Math.max(0, (now.getTime() - Date.parse(result.openSince)) / 3_600_000)

  const toggle = async (index: OdooInstanceIndex): Promise<void> => {
    setIsSaving(true)
    try {
      const openSince = await checkInOut(index)
      toast.success(
        openSince === null ? t("leaves.checkedOut") : t("leaves.checkedIn")
      )
      onChanged()
    } catch (error) {
      // Odoo's own button still works when the gateway can't sign in.
      toast.error(t("leaves.checkInError"), {
        description: error instanceof Error ? error.message : String(error),
        action:
          odooUrl === undefined
            ? undefined
            : {
                label: t("leaves.openOdoo"),
                onClick: () => window.open(`${odooUrl}/odoo`, "_blank"),
              },
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span
        aria-hidden
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          isIn ? "bg-success" : "bg-muted-foreground/40"
        )}
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm font-medium">
          {result.openSince === null
            ? t("leaves.checkedOutStatus")
            : t("leaves.checkedInSince", {
                time: formatTime(result.openSince),
              })}
        </p>
        {isIn && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("leaves.elapsed", { hours: formatHours(round2(elapsed)) })}
          </p>
        )}
      </div>
      {showInstance && <InstanceBadge instanceIndex={result.instanceIndex} />}
      <Button
        variant={isIn ? "outline" : "default"}
        disabled={isSaving}
        onClick={() => void toggle(result.instanceIndex)}
        className="max-sm:w-full"
      >
        {isSaving ? (
          <Loader2Icon className="animate-spin" />
        ) : isIn ? (
          <LogOutIcon />
        ) : (
          <LogInIcon />
        )}
        {isIn ? t("leaves.checkOut") : t("leaves.checkIn")}
      </Button>
    </div>
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Attendance: whether the user is checked in, and the period's hours. */
export function AttendanceCard() {
  const { t } = useTranslation()
  const { formatLongDate, formatTime, formatHours } = useFormatters()
  const [period, setPeriod] = useState<CommitPeriod>(() =>
    getPresetPeriod("thisWeek")
  )
  const now = useNow()
  const { from, to } = period
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchAttendance({ from, to }, { force }),
    [from, to]
  )
  const peek = useCallback(() => peekAttendance({ from, to }), [from, to])
  const query = useCachedQuery(`attendance:${from}:${to}`, fetcher, peek)
  const { data, error, isLoading, isRefreshing, refresh } = query

  const available = useMemo(
    () =>
      (data ?? []).filter(
        (result): result is AvailableAttendance => result.ok && result.available
      ),
    [data]
  )
  const showInstance = available.length > 1
  const days = useMemo(
    () =>
      groupAttendanceByDay(
        available.flatMap((result) => result.attendances),
        period,
        now
      ),
    [available, period, now]
  )
  const total = days.reduce((sum, day) => sum + day.hours, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("leaves.attendanceTitle")}</CardTitle>
        <CardDescription>{t("leaves.attendanceSubtitle")}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("leaves.refresh")}
            disabled={isLoading || isRefreshing}
            onClick={refresh}
          >
            <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data?.map(
          (result) =>
            !result.ok && (
              <InstanceErrorNotice
                key={result.instanceIndex}
                instanceIndex={result.instanceIndex}
                message={result.error}
              />
            )
        )}
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : data !== undefined && available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("leaves.attendanceUnavailable")}
          </p>
        ) : (
          available.map((result) => (
            <CheckInStatus
              key={result.instanceIndex}
              result={result}
              showInstance={showInstance}
              now={now}
              onChanged={refresh}
            />
          ))
        )}

        {available.length > 0 && (
          <>
            <CommitPeriodPicker
              value={period}
              onChange={setPeriod}
              disabled={false}
            />
            {isValidPeriod(period) && (
              <div className="grid gap-2">
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("leaves.periodTotal")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatHours(round2(total))}
                  </span>
                </p>
                {days.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("leaves.noAttendance")}
                  </p>
                ) : (
                  <ul className="grid divide-y rounded-lg border">
                    {days.map((day) => (
                      <li
                        key={day.date}
                        className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <div className="grid min-w-0 gap-0.5">
                          <span className="font-medium first-letter:uppercase">
                            {formatLongDate(day.date)}
                          </span>
                          {day.attendances.map((attendance) => (
                            <span
                              key={attendance.attendanceId}
                              className="text-xs text-muted-foreground tabular-nums"
                            >
                              {formatTime(attendance.checkIn)} –{" "}
                              {attendance.checkOut === null
                                ? t("leaves.ongoing")
                                : formatTime(attendance.checkOut)}
                            </span>
                          ))}
                        </div>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatHours(round2(day.hours))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
