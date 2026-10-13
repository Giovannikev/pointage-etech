import { useCallback } from "react"
import { InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import {
  fetchTimesheetHistory,
  peekTimesheetHistory,
} from "@/services/odooService"
import type {
  OdooInstanceIndex,
  TimesheetHistoryInstanceResult,
} from "@/types/timesheet"
import { analyzeDayLoad } from "@/utils/history"

interface DayLoadNoticeProps {
  /** YYYY-MM-DD */
  date: string
  instanceIndex: OdooInstanceIndex
  kind: "task" | "ticket"
  /** Task id or ticket id, depending on `kind`. */
  id: number
  /** Hours about to be logged. */
  hours: number
  description: string
}

/**
 * Before logging time, tells what the day already holds in Odoo: hours on
 * this task, the day's total, and warns about a duplicate or a too long day.
 */
export function DayLoadNotice({
  date,
  instanceIndex,
  kind,
  id,
  hours,
  description,
}: DayLoadNoticeProps) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const fetcher = useCallback(
    ({ force }: { force: boolean }) =>
      fetchTimesheetHistory({ from: date, to: date }, { force }),
    [date]
  )
  const peek = useCallback(
    () => peekTimesheetHistory({ from: date, to: date }),
    [date]
  )
  const day = useCachedQuery<TimesheetHistoryInstanceResult[]>(
    `history:${date}:${date}`,
    fetcher,
    peek
  )

  if (day.isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        {t("dayLoad.checking")}
      </p>
    )
  }
  if (day.data === undefined) {
    // Not blocking: the user can still log time without the check.
    return null
  }

  const load = analyzeDayLoad(day.data, {
    instanceIndex,
    kind,
    id,
    hours,
    description,
  })
  const warnings = [
    load.hasDuplicate
      ? t(kind === "ticket" ? "dayLoad.duplicateTicket" : "dayLoad.duplicate")
      : null,
    load.exceedsLimit
      ? t("dayLoad.tooLong", {
          total: formatHours(load.totalAfter),
          limit: formatHours(load.limit),
        })
      : null,
  ].filter((warning): warning is string => warning !== null)

  return (
    <div
      className={cn(
        "grid gap-1 rounded-lg border px-3 py-2 text-xs",
        warnings.length > 0
          ? "border-warning/40 bg-warning/5"
          : "bg-muted/30 text-muted-foreground"
      )}
      aria-live="polite"
    >
      <p className="flex items-start gap-2">
        <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
        {load.dayHours === 0
          ? t("dayLoad.nothingYet")
          : t(kind === "ticket" ? "dayLoad.alreadyTicket" : "dayLoad.already", {
              day: formatHours(load.dayHours),
              task: formatHours(load.taskHours),
            })}
      </p>
      {warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-2 font-medium text-warning"
        >
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          {warning}
        </p>
      ))}
    </div>
  )
}
