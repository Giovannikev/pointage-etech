import { useTranslation } from "react-i18next"

import { useFormatters } from "@/hooks/useFormatters"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import { startOfDay, todayIsoDate } from "@/utils/date"
import type { HistoryGrid } from "@/utils/history"
import { WORKDAY_HOURS } from "@/utils/timesheetRules"

function isWeekend(isoDate: string): boolean {
  const day = startOfDay(isoDate).getDay()
  return day === 0 || day === 6
}

/**
 * Tasks as rows, days as columns, like Odoo's timesheet grid: forgotten days
 * show as empty columns, short days as amber totals.
 */
export function HistoryWeekGrid({ grid }: { grid: HistoryGrid }) {
  const { t } = useTranslation()
  const { language, formatHours } = useFormatters()
  const today = todayIsoDate()
  const weekday = (isoDate: string) =>
    startOfDay(isoDate).toLocaleDateString(language, { weekday: "short" })
  const hoursText = (hours: number | undefined) =>
    hours === undefined ? "" : formatHours(hours).replace(/\s*h$/, "")

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">{t("history.grid.caption")}</caption>
        <thead className="bg-muted/40">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-56 bg-card px-3 py-2 text-left font-medium"
            >
              {t("timesheet.columns.task")}
            </th>
            {grid.dates.map((date) => (
              <th
                key={date}
                scope="col"
                className={cn(
                  "min-w-12 px-1 py-2 text-center text-xs font-medium",
                  isWeekend(date) && "text-muted-foreground",
                  date === today && "text-foreground underline"
                )}
              >
                <span className="block first-letter:uppercase">
                  {weekday(date)}
                </span>
                <span className="block text-muted-foreground">
                  {Number(date.slice(8))}
                </span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("history.grid.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.key} className="border-t">
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-72 bg-card px-3 py-2 text-left font-normal"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      INSTANCE_BACKGROUNDS[row.instanceIndex]
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate" title={row.label}>
                      {row.label}
                    </span>
                    {row.projectName !== null && (
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={row.projectName}
                      >
                        {row.projectName}
                      </span>
                    )}
                  </span>
                </span>
              </th>
              {grid.dates.map((date) => (
                <td
                  key={date}
                  className={cn(
                    "px-1 py-2 text-center",
                    isWeekend(date) && "bg-muted/30"
                  )}
                >
                  {hoursText(row.hoursByDate.get(date))}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-medium">
                {formatHours(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/40 font-semibold">
            <th
              scope="row"
              className="sticky left-0 z-10 bg-card px-3 py-2 text-left"
            >
              {t("history.grid.dayTotal")}
            </th>
            {grid.dates.map((date) => {
              const total = grid.totalsByDate.get(date)
              const isPast = date <= today
              return (
                <td
                  key={date}
                  className={cn(
                    "px-1 py-2 text-center",
                    total !== undefined &&
                      (total >= WORKDAY_HOURS
                        ? "text-success"
                        : "text-warning"),
                    total === undefined &&
                      isPast &&
                      !isWeekend(date) &&
                      "bg-warning/10"
                  )}
                  title={
                    total === undefined && isPast && !isWeekend(date)
                      ? t("history.grid.missingDay")
                      : undefined
                  }
                >
                  {total === undefined ? "" : hoursText(total)}
                </td>
              )
            })}
            <td className="px-3 py-2 text-right">{formatHours(grid.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
