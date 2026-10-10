import { useState } from "react"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import { useFormatters } from "@/hooks/useFormatters"
import { CALENDAR_LOCALES } from "@/lib/calendarLocales"
import type { CommitPeriod } from "@/types/timesheet"
import { startOfDay, toIsoDate } from "@/utils/date"

/** A range being picked: `to` stays undefined between the two clicks. */
interface DraftRange {
  from: Date
  to: Date | undefined
}

function toDraft(period: CommitPeriod): DraftRange {
  return { from: startOfDay(period.from), to: startOfDay(period.to) }
}

interface DateRangePickerProps {
  value: CommitPeriod
  onChange: (period: CommitPeriod) => void
  disabled: boolean
  invalid: boolean
}

/** Calendar (two months, one on phones): the first click starts the range, the second ends and applies it. */
export function DateRangePicker({
  value,
  onChange,
  disabled,
  invalid,
}: DateRangePickerProps) {
  const { t } = useTranslation()
  const { language, formatMediumDate } = useFormatters()
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState<DraftRange>(() => toDraft(value))

  const range =
    value.from === value.to
      ? formatMediumDate(value.from)
      : `${formatMediumDate(value.from)} – ${formatMediumDate(value.to)}`

  const handleOpenChange = (open: boolean): void => {
    if (open) {
      setDraft(toDraft(value))
    }
    setIsOpen(open)
  }

  const handleSelect = (_range: DateRange | undefined, day: Date): void => {
    if (draft.to !== undefined) {
      setDraft({ from: day, to: undefined })
      return
    }
    const [from, to] = day < draft.from ? [day, draft.from] : [draft.from, day]
    onChange({ from: toIsoDate(from), to: toIsoDate(to) })
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid}
          aria-label={t("period.rangeLabel", { range })}
          className="font-normal"
        >
          <CalendarIcon />
          {range}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={isMobile ? 1 : 2}
          weekStartsOn={1}
          locale={CALENDAR_LOCALES[language]}
          defaultMonth={draft.from}
          selected={draft}
          onSelect={handleSelect}
        />
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {draft.to === undefined
            ? t("period.pickLastDay")
            : t("period.pickFirstDay")}
        </p>
      </PopoverContent>
    </Popover>
  )
}
