import { useCallback, useEffect, useMemo } from "react"
import { ArrowRightIcon, CheckCircle2Icon, ClockIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Skeleton } from "@/components/ui/skeleton"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { useNow } from "@/hooks/useNow"
import { cn } from "@/lib/utils"
import {
  fetchAttendance,
  fetchTimesheetHistory,
  onAttendanceChanged,
  peekAttendance,
  peekTimesheetHistory,
} from "@/services/odooService"
import type { CommitPeriod, TimesheetHistoryEntry } from "@/types/timesheet"
import { attendanceHours, formatDuration } from "@/utils/leaves"
import { isInPeriod } from "@/utils/period"
import { toLocalIsoDate } from "@/utils/date"

/** Below this gap (6 minutes), presence and logged time agree. */
const GAP_TOLERANCE = 0.1
/** Lines listed under the totals before "See the history". */
const LINE_PREVIEW = 5

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "warning" | "success"
}) {
  return (
    <div className="grid gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success"
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * What the period already holds in Odoo before any commit is imported: the
 * time logged, the time present (Attendances), and what is left to log.
 */
export function PeriodOverview({ period }: { period: CommitPeriod }) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const now = useNow()
  const { from, to } = period

  const historyFetcher = useCallback(
    ({ force }: { force: boolean }) =>
      fetchTimesheetHistory({ from, to }, { force }),
    [from, to]
  )
  const historyPeek = useCallback(
    () => peekTimesheetHistory({ from, to }),
    [from, to]
  )
  const history = useCachedQuery(
    `history:${from}:${to}`,
    historyFetcher,
    historyPeek
  )
  const attendanceFetcher = useCallback(
    ({ force }: { force: boolean }) => fetchAttendance({ from, to }, { force }),
    [from, to]
  )
  const attendancePeek = useCallback(
    () => peekAttendance({ from, to }),
    [from, to]
  )
  const attendance = useCachedQuery(
    `attendance:${from}:${to}`,
    attendanceFetcher,
    attendancePeek
  )
  const { refresh: refreshAttendance } = attendance
  useEffect(() => onAttendanceChanged(refreshAttendance), [refreshAttendance])

  const entries = useMemo(
    () =>
      (history.data ?? [])
        .flatMap((result) => (result.ok ? result.entries : []))
        .sort((a, b) => b.hours - a.hours),
    [history.data]
  )
  const logged = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const attendances = (attendance.data ?? []).flatMap((result) =>
    result.ok && result.available ? result.attendances : []
  )
  const hasAttendance = (attendance.data ?? []).some(
    (result) => result.ok && result.available
  )
  const present = attendances
    .filter((item) => isInPeriod(toLocalIsoDate(item.checkIn), period))
    .reduce((sum, item) => sum + attendanceHours(item, now), 0)
  const left = present - logged

  if (history.isLoading) {
    return <Skeleton className="h-28 w-full rounded-xl" />
  }
  if (history.error !== null) {
    return null
  }

  const lineName = (entry: TimesheetHistoryEntry) =>
    entry.taskName ?? entry.ticketName ?? entry.projectName ?? "—"

  return (
    <section className="grid gap-4 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Stat
            label={t("timesheet.overview.logged")}
            value={formatHours(logged)}
          />
          {hasAttendance && (
            <Stat
              label={t("timesheet.overview.present")}
              value={formatDuration(present)}
            />
          )}
          {hasAttendance && present > 0 && (
            <Stat
              label={t("timesheet.overview.left")}
              value={left > GAP_TOLERANCE ? formatDuration(left) : "0:00"}
              tone={left > GAP_TOLERANCE ? "warning" : "success"}
            />
          )}
        </div>
        <a
          href={`#history?from=${from}&to=${to}`}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {t("timesheet.overview.history")}
          <ArrowRightIcon className="size-4" />
        </a>
      </div>

      {hasAttendance && present > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {left > GAP_TOLERANCE ? (
            <ClockIcon className="size-4 text-warning" />
          ) : (
            <CheckCircle2Icon className="size-4 text-success" />
          )}
          {left > GAP_TOLERANCE
            ? t("timesheet.overview.leftHint")
            : t("timesheet.overview.allLogged")}
        </p>
      )}

      {entries.length > 0 && (
        <ul className="grid divide-y rounded-lg border">
          {entries.slice(0, LINE_PREVIEW).map((entry) => (
            <li
              key={`${entry.instanceIndex}:${entry.timesheetId}`}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <InstanceBadge instanceIndex={entry.instanceIndex} />
              <div className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{lineName(entry)}</span>
                {entry.description !== "" && (
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.description}
                  </span>
                )}
              </div>
              <span className="shrink-0 tabular-nums">
                {formatHours(entry.hours)}
              </span>
            </li>
          ))}
          {entries.length > LINE_PREVIEW && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t("timesheet.overview.more", {
                count: entries.length - LINE_PREVIEW,
              })}
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
