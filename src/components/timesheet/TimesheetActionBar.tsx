import { Loader2Icon, SendIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useFormatters } from "@/hooks/useFormatters"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex, TimesheetEntry } from "@/types/timesheet"
import { expectedHours, isInOdoo, roundHours } from "@/utils/timesheetRules"

const SEGMENT_COLORS: Record<OdooInstanceIndex | "none", string> = {
  ...INSTANCE_BACKGROUNDS,
  none: "bg-muted-foreground/40",
}

interface HoursMeterProps {
  entries: TimesheetEntry[]
  totalHours: number
}

/**
 * Horizontal track of the expected hours (one workday per date in the list).
 * Each line is a segment sized by its hours and colored by Odoo instance;
 * lines already in Odoo are solid, others faded.
 */
function HoursMeter({ entries, totalHours }: HoursMeterProps) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const target = expectedHours(entries)
  const scale = Math.max(target, totalHours)
  const targetMark = (target / scale) * 100
  const remaining = roundHours(target - totalHours)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {formatHours(totalHours)}
        </span>
        <span className="text-sm text-muted-foreground">
          {remaining > 0
            ? t("hoursMeter.left", {
                remaining: formatHours(remaining),
                target: formatHours(target),
              })
            : remaining === 0
              ? t("hoursMeter.reached")
              : t("hoursMeter.over", {
                  over: formatHours(-remaining),
                  target: formatHours(target),
                })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={t("hoursMeter.label")}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={totalHours}
        aria-valuetext={t("hoursMeter.valueText", {
          logged: formatHours(totalHours),
          target: formatHours(target),
        })}
        className="relative flex h-2 w-full max-w-xl overflow-hidden rounded-full bg-muted"
      >
        {entries.map((entry) => (
          <span
            key={entry.id}
            className={cn(
              "h-full shrink-0 border-r-2 border-background transition-[width,opacity] duration-300 last:border-r-0 motion-reduce:transition-none",
              SEGMENT_COLORS[entry.task?.instanceIndex ?? "none"],
              !isInOdoo(entry) && "opacity-45"
            )}
            style={{ width: `${(entry.hours / scale) * 100}%` }}
          />
        ))}
        {totalHours > target && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: `${targetMark}%` }}
          />
        )}
      </div>
    </div>
  )
}

interface TimesheetActionBarProps {
  entries: TimesheetEntry[]
  totalHours: number
  submittableCount: number
  isSubmitting: boolean
  onSubmitAll: () => void
}

export function TimesheetActionBar({
  entries,
  totalHours,
  submittableCount,
  isSubmitting,
  onSubmitAll,
}: TimesheetActionBarProps) {
  const { t } = useTranslation()
  const instances = useOdooInstances()

  return (
    <div className="sticky bottom-0 z-40 mt-auto border-t bg-background/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 sm:flex-nowrap sm:px-6 lg:px-8">
        <HoursMeter entries={entries} totalHours={totalHours} />
        <div className="flex shrink-0 items-center gap-3">
          <ul className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
            {instances.map((instance) => (
              <li key={instance.index} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-full",
                    INSTANCE_BACKGROUNDS[instance.index]
                  )}
                />
                {instance.label}
              </li>
            ))}
          </ul>
          <Button
            size="lg"
            disabled={submittableCount === 0 || isSubmitting}
            onClick={onSubmitAll}
          >
            {isSubmitting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            {t("hoursMeter.submitAll")}
            {submittableCount > 0 && (
              <span className="tabular-nums opacity-70">
                {submittableCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
