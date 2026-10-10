import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  EntryActivity,
  StatusDetail,
  TimesheetStatus,
} from "@/types/timesheet"
import { cn } from "@/lib/utils"

const STATUS_DOTS: Record<TimesheetStatus, string> = {
  pending: "bg-muted-foreground/50",
  found: "bg-success",
  missing: "bg-warning",
  logged: "bg-instance-2",
  submitted: "bg-success",
  error: "bg-destructive",
}

interface StatusBadgeProps {
  status: TimesheetStatus
  activity: EntryActivity
  detail: StatusDetail | null
}

export function StatusBadge({ status, activity, detail }: StatusBadgeProps) {
  const { t } = useTranslation()
  const isBusy = activity !== "idle"
  const label = t(
    activity === "submitting" ? "status.submitting" : `status.${status}`
  )
  const message =
    detail === null
      ? null
      : detail.reason === "serverError"
        ? detail.message
        : detail.reason === "taskNotFound"
          ? t("status.taskNotFound", { taskRef: detail.taskRef })
          : t(`status.${detail.reason}`)

  const badge = (
    <Badge
      variant={
        status === "submitted" || status === "logged" ? "secondary" : "outline"
      }
      className={cn("gap-1.5", status === "error" && "border-destructive/40")}
      aria-live="polite"
    >
      {isBusy ? (
        <Loader2Icon className="animate-spin" aria-hidden />
      ) : (
        <span
          className={cn("size-1.5 rounded-full", STATUS_DOTS[status])}
          aria-hidden
        />
      )}
      {label}
    </Badge>
  )

  if (message === null) {
    return badge
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`${label}: ${message}`}
        >
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{message}</TooltipContent>
    </Tooltip>
  )
}
