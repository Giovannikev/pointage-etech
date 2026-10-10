import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useInstanceLabel } from "@/contexts/SettingsContext"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex } from "@/types/timesheet"

const INSTANCE_STYLES: Record<OdooInstanceIndex, string> = {
  1: "bg-instance-1/12 text-instance-1 dark:bg-instance-1/18",
  2: "bg-instance-2/12 text-instance-2 dark:bg-instance-2/18",
}

function KnownInstanceBadge({ index }: { index: OdooInstanceIndex }) {
  const label = useInstanceLabel(index)
  return (
    <Badge
      className={cn("max-w-28 font-semibold", INSTANCE_STYLES[index])}
      title={label}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}

interface InstanceBadgeProps {
  instanceIndex: OdooInstanceIndex | null
}

export function InstanceBadge({ instanceIndex }: InstanceBadgeProps) {
  const { t } = useTranslation()
  if (instanceIndex === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("timesheet.notFound")}
      </Badge>
    )
  }
  return <KnownInstanceBadge index={instanceIndex} />
}
