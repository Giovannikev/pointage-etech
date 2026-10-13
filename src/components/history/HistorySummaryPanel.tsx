import { CircleCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import type { ChartDay, HistorySummary } from "@/utils/history"

interface DailyHoursChartProps {
  days: ChartDay[]
  target: number
}

/**
 * One bar per day against the workday target (dashed line). Full days are
 * green, short ones amber; an empty weekday keeps a stub so gaps show.
 */
function DailyHoursChart({ days, target }: DailyHoursChartProps) {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  if (days.length === 0) {
    return null
  }
  const scale = Math.max(target * 1.25, ...days.map((day) => day.hours))
  const targetLine = (target / scale) * 100
  const showDayNumbers = days.length <= 31

  return (
    <figure className="grid min-w-0 gap-2">
      <figcaption className="text-xs text-muted-foreground">
        {t("history.chartCaption", { target: formatHours(target) })}
      </figcaption>
      <div className="relative h-28">
        <span
          aria-hidden
          className="absolute inset-x-0 border-t border-dashed border-foreground/30"
          style={{ bottom: `${targetLine}%` }}
        />
        <ol className="absolute inset-0 flex items-end gap-1">
          {days.map((day) => {
            const height = (day.hours / scale) * 100
            const isFull = day.hours >= target
            return (
              <li
                key={day.date}
                className="flex h-full max-w-8 min-w-1 flex-1 items-end"
                title={`${formatShortDate(day.date)}: ${formatHours(day.hours)}`}
              >
                <span className="sr-only">
                  {formatShortDate(day.date)}: {formatHours(day.hours)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "w-full rounded-t-sm",
                    day.hours === 0
                      ? "h-0.5 bg-muted-foreground/30"
                      : isFull
                        ? "bg-success"
                        : "bg-warning"
                  )}
                  style={day.hours === 0 ? undefined : { height: `${height}%` }}
                />
              </li>
            )
          })}
        </ol>
      </div>
      {showDayNumbers && (
        <div aria-hidden className="flex gap-1">
          {days.map((day) => (
            <span
              key={day.date}
              className="max-w-8 min-w-1 flex-1 text-center text-[0.65rem] text-muted-foreground tabular-nums"
            >
              {Number(day.date.slice(8))}
            </span>
          ))}
        </div>
      )}
    </figure>
  )
}

interface HistorySummaryPanelProps {
  summary: HistorySummary
  chart: ChartDay[]
}

export function HistorySummaryPanel({
  summary,
  chart,
}: HistorySummaryPanelProps) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const meetsTarget =
    summary.loggedDays > 0 && summary.averagePerDay >= summary.target

  return (
    <section
      aria-label={t("history.summaryLabel")}
      className="grid gap-6 rounded-xl border bg-card p-4 sm:p-5 lg:grid-cols-[auto_1fr]"
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 xl:items-start">
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">
            {t("history.totalHours")}
          </dt>
          <dd className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatHours(summary.totalHours)}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">
            {t("history.averagePerDay")}
          </dt>
          <dd
            className={cn(
              "flex items-center gap-1.5 text-3xl font-semibold tracking-tight tabular-nums",
              summary.loggedDays > 0 &&
                (meetsTarget ? "text-success" : "text-warning")
            )}
          >
            {formatHours(summary.averagePerDay)}
            {meetsTarget && (
              <CircleCheckIcon
                className="size-5"
                aria-label={t("history.targetMet")}
              />
            )}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">
            {t("history.fullDays", { target: formatHours(summary.target) })}
          </dt>
          <dd className="text-3xl font-semibold tracking-tight tabular-nums">
            {summary.fullDays}
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              / {summary.loggedDays}
            </span>
          </dd>
        </div>
      </dl>
      <DailyHoursChart days={chart} target={summary.target} />
    </section>
  )
}
