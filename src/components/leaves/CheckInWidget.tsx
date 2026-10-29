import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2Icon, LogInIcon, LogOutIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useCheckInOut } from "@/hooks/useCheckInOut"
import { useFormatters } from "@/hooks/useFormatters"
import { toViewHash } from "@/hooks/useHashNavigation"
import { useNow } from "@/hooks/useNow"
import { cn } from "@/lib/utils"
import {
  fetchAttendance,
  onAttendanceChanged,
  peekAttendance,
} from "@/services/odooService"
import type { AttendanceInstanceResult } from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import { formatDuration, groupAttendanceByDay } from "@/utils/leaves"

type AvailableAttendance = Extract<AttendanceInstanceResult, { ok: true }>

function WidgetPanel({
  result,
  workedToday,
  onNavigate,
}: {
  result: AvailableAttendance
  workedToday: number
  /** Closes the panel when the link leaves for the attendance page. */
  onNavigate: () => void
}) {
  const { t } = useTranslation()
  const { formatTime } = useFormatters()
  const { isSaving, toggle } = useCheckInOut(result.instanceIndex)
  const isIn = result.openSince !== null

  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <p className="text-sm font-medium">
          {result.openSince === null
            ? t("leaves.checkedOutStatus")
            : t("leaves.checkedInSince", {
                time: formatTime(result.openSince),
              })}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("leaves.widget.today", { hours: formatDuration(workedToday) })}
        </p>
      </div>
      <Button
        variant={isIn ? "outline" : "default"}
        disabled={isSaving}
        onClick={() => void toggle()}
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
      <a
        href={toViewHash("leaves")}
        onClick={onNavigate}
        className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("leaves.widget.details")}
      </a>
    </div>
  )
}

/**
 * Attendance button of the page header: the time worked today while checked
 * in, "Absent" otherwise. It opens a panel to check in or out, so a stray
 * tap never records an attendance. Hidden without the Attendances app.
 */
export function CheckInWidget() {
  const { t } = useTranslation()
  const now = useNow()
  const today = todayIsoDate()
  const period = useMemo(() => ({ from: today, to: today }), [today])
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchAttendance(period, { force }),
    [period]
  )
  const peek = useCallback(() => peekAttendance(period), [period])
  const { data, refresh } = useCachedQuery(
    `attendance:${today}:${today}`,
    fetcher,
    peek
  )
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => onAttendanceChanged(refresh), [refresh])
  // A check-in made in Odoo itself shows when the user comes back to the app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [refresh])

  // The first instance with the Attendances app: where the user checks in.
  const result = data?.find(
    (candidate): candidate is AvailableAttendance =>
      candidate.ok && candidate.available
  )
  const workedToday = useMemo(
    () =>
      result === undefined
        ? 0
        : (groupAttendanceByDay(result.attendances, period, now)[0]?.hours ??
          0),
    [result, period, now]
  )
  if (result === undefined) {
    return null
  }

  const isIn = result.openSince !== null
  const label = isIn
    ? formatDuration(workedToday)
    : workedToday > 0
      ? `${t("leaves.checkedOutStatus")} · ${formatDuration(workedToday)}`
      : t("leaves.checkedOutStatus")

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 rounded-full"
          aria-label={t("leaves.widget.label", { status: label })}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              isIn ? "animate-pulse bg-success" : "bg-muted-foreground/40"
            )}
          />
          <span className="tabular-nums">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-64">
        <WidgetPanel
          result={result}
          workedToday={workedToday}
          onNavigate={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
