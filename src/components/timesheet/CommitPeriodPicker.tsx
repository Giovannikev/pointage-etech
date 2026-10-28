import { useTranslation } from "react-i18next"

import { DateRangePicker } from "@/components/timesheet/DateRangePicker"
import { MonthPicker } from "@/components/timesheet/MonthPicker"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { CommitPeriod } from "@/types/timesheet"
import {
  findMonth,
  findPreset,
  getMonthPeriod,
  getPresetPeriod,
  isPeriodPreset,
  isValidPeriod,
  PERIOD_PRESETS,
} from "@/utils/period"

interface CommitPeriodPickerProps {
  value: CommitPeriod
  onChange: (period: CommitPeriod) => void
  disabled: boolean
}

/** Presets for the usual periods, a whole month, or any range of days. */
export function CommitPeriodPicker({
  value,
  onChange,
  disabled,
}: CommitPeriodPickerProps) {
  const { t } = useTranslation()
  const isValid = isValidPeriod(value)

  const selectPreset = (preset: string): void => {
    if (isPeriodPreset(preset)) {
      onChange(getPresetPeriod(preset))
    }
  }

  const selectMonth = (month: string): void => {
    const period = getMonthPeriod(month)
    if (period !== null) {
      onChange(period)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="flex-wrap"
            aria-label={t("period.label")}
            value={findPreset(value) ?? ""}
            onValueChange={selectPreset}
            disabled={disabled}
          >
            {PERIOD_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset} value={preset}>
                {t(`period.${preset}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <MonthPicker
          value={findMonth(value)}
          onChange={selectMonth}
          disabled={disabled}
        />
        <DateRangePicker
          value={value}
          onChange={onChange}
          disabled={disabled}
          invalid={!isValid}
        />
      </div>
      {!isValid && (
        <p className="text-xs text-destructive" role="alert">
          {t("period.tooLong")}
        </p>
      )}
    </div>
  )
}
