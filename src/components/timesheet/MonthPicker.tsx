import { useMemo, useState } from "react"
import {
  CalendarRangeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useFormatters } from "@/hooks/useFormatters"
import { toMonthValue } from "@/utils/period"

function yearOf(month: string): number {
  return month === "" ? new Date().getFullYear() : Number(month.slice(0, 4))
}

interface MonthPickerProps {
  /** Selected month ("2026-01"), or "" when the period isn't a whole month. */
  value: string
  onChange: (month: string) => void
  disabled: boolean
}

/** Picks a whole calendar month: a year switcher over a grid of months. */
export function MonthPicker({ value, onChange, disabled }: MonthPickerProps) {
  const { t } = useTranslation()
  const { language, formatMonth } = useFormatters()
  const [isOpen, setIsOpen] = useState(false)
  const [year, setYear] = useState(() => yearOf(value))
  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthIndex) =>
        new Date(2000, monthIndex, 1).toLocaleDateString(language, {
          month: "short",
        })
      ),
    [language]
  )

  const handleOpenChange = (open: boolean): void => {
    if (open) {
      setYear(yearOf(value))
    }
    setIsOpen(open)
  }

  const selectMonth = (monthIndex: number): void => {
    onChange(toMonthValue(year, monthIndex))
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className="font-normal">
          <CalendarRangeIcon />
          {value === "" ? t("period.pickMonth") : formatMonth(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("period.previousYear")}
            onClick={() => setYear((current) => current - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-sm font-medium tabular-nums">{year}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("period.nextYear")}
            onClick={() => setYear((current) => current + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {monthLabels.map((label, monthIndex) => {
            const isSelected = toMonthValue(year, monthIndex) === value
            return (
              <Button
                key={label}
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                aria-pressed={isSelected}
                onClick={() => selectMonth(monthIndex)}
              >
                {label}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
