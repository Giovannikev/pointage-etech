import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import type { KanbanTaskStatus } from "@/types/timesheet"

const STATUS_DOTS: Record<KanbanTaskStatus, string> = {
  in_progress: "bg-muted-foreground/50",
  changes_requested: "bg-warning",
  approved: "bg-success",
  done: "bg-success",
  canceled: "bg-muted-foreground/40",
  waiting: "bg-muted-foreground/60",
  blocked: "bg-destructive",
}

/** Odoo's task state; "in progress" is the norm, so it isn't shown. */
export function TaskStatusBadge({
  status,
}: {
  status: KanbanTaskStatus | null
}) {
  const { t } = useTranslation()
  if (status === null || status === "in_progress") {
    return null
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        status === "blocked" && "font-medium text-destructive"
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", STATUS_DOTS[status])}
      />
      {t(`kanban.status.${status}`)}
    </span>
  )
}
