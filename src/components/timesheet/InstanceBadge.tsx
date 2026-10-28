import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useInstanceLabel } from "@/contexts/SettingsContext"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex } from "@/types/timesheet"

const INSTANCE_STYLES: Record<OdooInstanceIndex, string> = {
  1: "bg-instance-1/12 text-instance-1 dark:bg-instance-1/18",
  2: "bg-instance-2/12 text-instance-2 dark:bg-instance-2/18",
}

function KnownInstanceBadge({
  index,
  className,
}: {
  index: OdooInstanceIndex
  className?: string
}) {
  const label = useInstanceLabel(index)
  return (
    <Badge
      className={cn(
        "max-w-28 font-semibold",
        INSTANCE_STYLES[index],
        className
      )}
      title={label}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}

interface InstanceBadgeProps {
  instanceIndex: OdooInstanceIndex | null
  className?: string
}

export function InstanceBadge({
  instanceIndex,
  className,
}: InstanceBadgeProps) {
  const { t } = useTranslation()
  if (instanceIndex === null) {
    return (
      <Badge
        variant="outline"
        className={cn("text-muted-foreground", className)}
      >
        {t("timesheet.notFound")}
      </Badge>
    )
  }
  return <KnownInstanceBadge index={instanceIndex} className={className} />
}
