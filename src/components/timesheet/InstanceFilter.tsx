import { useTranslation } from "react-i18next"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex } from "@/types/timesheet"

export type InstanceFilterValue = "all" | OdooInstanceIndex

function parseFilter(value: string): InstanceFilterValue | null {
  if (value === "all") return "all"
  if (value === "1") return 1
  if (value === "2") return 2
  return null
}

export function matchesInstance(
  filter: InstanceFilterValue,
  instanceIndex: OdooInstanceIndex
): boolean {
  return filter === "all" || filter === instanceIndex
}

interface InstanceFilterProps {
  value: InstanceFilterValue
  onChange: (value: InstanceFilterValue) => void
  disabled?: boolean
}

/** All instances, or one of them; hidden when only one is configured. */
export function InstanceFilter({
  value,
  onChange,
  disabled = false,
}: InstanceFilterProps) {
  const { t } = useTranslation()
  const instances = useOdooInstances()
  if (instances.length < 2) {
    return null
  }

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={t("instanceFilter.label")}
      value={String(value)}
      // Radix sends "" when the active item is clicked again: keep the choice.
      onValueChange={(next) => {
        const parsed = parseFilter(next)
        if (parsed !== null) {
          onChange(parsed)
        }
      }}
      disabled={disabled}
    >
      <ToggleGroupItem value="all">{t("instanceFilter.all")}</ToggleGroupItem>
      {instances.map((instance) => (
        <ToggleGroupItem
          key={instance.index}
          value={String(instance.index)}
          className="max-w-40"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              INSTANCE_BACKGROUNDS[instance.index]
            )}
          />
          <span className="truncate">{instance.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
