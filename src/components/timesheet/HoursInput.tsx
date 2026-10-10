import { useState, type KeyboardEvent } from "react"

import { Input } from "@/components/ui/input"
import {
  HOURS_STEP,
  isValidHours,
  MAX_HOURS,
  MIN_HOURS,
} from "@/utils/timesheetRules"

interface HoursInputProps {
  value: number
  disabled: boolean
  label: string
  onCommit: (hours: number) => void
}

/** Numeric hours field that only commits valid values, on blur or Enter. */
export function HoursInput({
  value,
  disabled,
  label,
  onCommit,
}: HoursInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const displayed = draft ?? String(value)
  const isInvalid = draft !== null && !isValidHours(Number(draft))

  const commit = (): void => {
    if (draft !== null) {
      const hours = Number(draft)
      if (isValidHours(hours) && hours !== value) {
        onCommit(hours)
      }
    }
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur()
    } else if (event.key === "Escape") {
      setDraft(null)
    }
  }

  return (
    <Input
      type="number"
      inputMode="decimal"
      min={MIN_HOURS}
      max={MAX_HOURS}
      step={HOURS_STEP}
      value={displayed}
      disabled={disabled}
      aria-label={label}
      aria-invalid={isInvalid}
      className="w-20 text-right tabular-nums"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
