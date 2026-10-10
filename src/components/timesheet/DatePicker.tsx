import { useState } from "react"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useFormatters } from "@/hooks/useFormatters"
import { CALENDAR_LOCALES } from "@/lib/calendarLocales"
import { startOfDay, toIsoDate } from "@/utils/date"

interface DatePickerProps {
  id?: string
  /** YYYY-MM-DD */
  value: string
  onChange: (isoDate: string) => void
}

/** A single day, picked in a calendar. */
export function DatePicker({ id, value, onChange }: DatePickerProps) {
  const { language, formatMediumDate } = useFormatters()
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (day: Date | undefined): void => {
    if (day !== undefined) {
      onChange(toIsoDate(day))
      setIsOpen(false)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="justify-start font-normal"
        >
          <CalendarIcon />
          {formatMediumDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          required
          weekStartsOn={1}
          locale={CALENDAR_LOCALES[language]}
          defaultMonth={startOfDay(value)}
          selected={startOfDay(value)}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
