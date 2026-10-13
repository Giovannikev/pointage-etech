import { CalendarClockIcon, StarIcon, TimerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TaskStatusBadge } from "@/components/kanban/TaskStatusBadge"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import type { KanbanTask, OdooInstanceIndex } from "@/types/timesheet"
import { toLocalIsoDate, todayIsoDate } from "@/utils/date"
import { hoursProgress, splitTaskName } from "@/utils/kanban"

/** The instance color runs down the card's left edge. */
const INSTANCE_EDGES: Record<OdooInstanceIndex, string> = {
  1: "border-l-instance-1",
  2: "border-l-instance-2",
}

interface KanbanCardProps {
  task: KanbanTask
  showInstance: boolean
  /** What the card names under its title: its project, or its stage when the board is grouped by project. */
  context: "project" | "stage"
  onOpenTask: (task: KanbanTask) => void
  onLogTime: (task: KanbanTask) => void
}

function TaskHours({ task }: { task: KanbanTask }) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  if (task.effectiveHours === null) {
    return null
  }
  const progress = hoursProgress(task)
  const isOver =
    task.plannedHours !== null && task.effectiveHours > task.plannedHours

  return (
    <div className="grid min-w-0 gap-1">
      <span
        className={cn(
          "text-xs text-muted-foreground tabular-nums",
          isOver && "font-medium text-warning"
        )}
      >
        {task.plannedHours === null
          ? t("kanban.hoursLogged", { hours: formatHours(task.effectiveHours) })
          : t("kanban.hoursOfPlanned", {
              hours: formatHours(task.effectiveHours),
              planned: formatHours(task.plannedHours),
            })}
      </span>
      {progress !== null && (
        <span
          aria-hidden
          className="h-1 w-20 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cn(
              "block h-full rounded-full",
              isOver ? "bg-warning" : "bg-foreground/60"
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      )}
    </div>
  )
}

export function KanbanCard({
  task,
  showInstance,
  context,
  onOpenTask,
  onLogTime,
}: KanbanCardProps) {
  const { t } = useTranslation()
  const { formatShortDate } = useFormatters()
  const { ref, title } = splitTaskName(task.name)
  const deadline = task.deadline === null ? null : toLocalIsoDate(task.deadline)
  const isOverdue = deadline !== null && deadline < todayIsoDate()
  const canLog = task.projectId !== null
  const detail = context === "project" ? task.projectName : task.stageName

  return (
    <article
      className={cn(
        "grid gap-2 rounded-lg border border-l-[3px] bg-card p-3 shadow-xs",
        INSTANCE_EDGES[task.instanceIndex]
      )}
      aria-label={task.name}
    >
      <div className="flex min-w-0 items-center gap-2">
        {ref !== null && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            [{ref}]
          </span>
        )}
        {task.priority > 0 && (
          <StarIcon
            className="size-3.5 shrink-0 fill-warning text-warning"
            aria-label={t("kanban.starred")}
          />
        )}
        <TaskStatusBadge status={task.status} />
        {showInstance && (
          <span className="ml-auto min-w-0">
            <InstanceBadge instanceIndex={task.instanceIndex} />
          </span>
        )}
      </div>

      <button
        type="button"
        className="line-clamp-2 rounded-sm text-left text-sm leading-snug font-medium outline-none hover:text-primary hover:underline hover:decoration-dotted hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
        title={t("timesheet.showDetails", { name: task.name })}
        onClick={() => onOpenTask(task)}
      >
        {title}
      </button>

      {detail !== null && (
        <p className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      )}

      <div className="flex items-end justify-between gap-2">
        <div className="grid min-w-0 gap-1.5">
          {deadline !== null && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs text-muted-foreground",
                isOverdue && "font-medium text-destructive"
              )}
            >
              <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
              {isOverdue
                ? t("kanban.overdue", { date: formatShortDate(deadline) })
                : formatShortDate(deadline)}
            </span>
          )}
          <TaskHours task={task} />
        </div>

        {canLog ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onLogTime(task)}
          >
            <TimerIcon />
            {t("kanban.logTime")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events: the span carries the tooltip. */}
              <span tabIndex={0} className="shrink-0 rounded-lg">
                <Button variant="outline" size="sm" disabled>
                  <TimerIcon />
                  {t("kanban.logTime")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("kanban.noProject")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </article>
  )
}
