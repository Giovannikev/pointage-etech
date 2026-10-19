import { useState } from "react"
import {
  CalendarClockIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  StarIcon,
  TimerIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  TaskStatusBadge,
  TaskStatusMenu,
} from "@/components/kanban/TaskStatusBadge"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { toLocalIsoDate, todayIsoDate } from "@/utils/date"
import { hoursProgress, splitTaskName } from "@/utils/kanban"

/** The instance color runs down the card's left edge. */
const INSTANCE_EDGES: Record<OdooInstanceIndex, string> = {
  1: "border-l-instance-1",
  2: "border-l-instance-2",
}

/** What the board lets the user change on a card, written to Odoo. */
export interface CardEditing {
  /** States the task's instance accepts. */
  statusOptions: KanbanTaskStatus[]
  /** Stages of the task's project it can move to; read when the menu opens. */
  getMoveTargets: (task: KanbanTask) => KanbanStage[]
  /** A change of this task is being saved: the card waits for Odoo. */
  isSaving: boolean
  /** The card can be dragged onto another stage column. */
  isDraggable: boolean
  onChangeStatus: (task: KanbanTask, status: KanbanTaskStatus) => void
  onMove: (task: KanbanTask, stage: KanbanStage) => void
  onDragStart: (task: KanbanTask) => void
  onDragEnd: () => void
}

interface KanbanCardProps {
  task: KanbanTask
  showInstance: boolean
  /** What the card names under its title: its project, or its stage when the board is grouped by project. */
  context: "project" | "stage"
  onOpenTask: (task: KanbanTask) => void
  onLogTime: (task: KanbanTask) => void
  /** Without it, the card is read only (Tasks page). */
  editing?: CardEditing
}

/** "Move to" menu: the keyboard and touch way to change the stage. */
function MoveMenu({
  task,
  editing,
}: {
  task: KanbanTask
  editing: CardEditing
}) {
  const { t } = useTranslation()
  const [targets, setTargets] = useState<KanbanStage[]>([])

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setTargets(editing.getMoveTargets(task))
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          disabled={editing.isSaving}
          aria-label={t("kanban.cardActions", { name: task.name })}
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-52">
        <DropdownMenuLabel>{t("kanban.moveTo")}</DropdownMenuLabel>
        {targets.map((stage) => (
          <DropdownMenuItem
            key={stage.stageId}
            onSelect={() => editing.onMove(task, stage)}
          >
            {stage.name}
          </DropdownMenuItem>
        ))}
        {targets.length === 0 && (
          <DropdownMenuItem disabled>
            {t("kanban.noMoveTarget")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  editing,
}: KanbanCardProps) {
  const { t } = useTranslation()
  const { formatShortDate } = useFormatters()
  const { ref, title } = splitTaskName(task.name)
  const deadline = task.deadline === null ? null : toLocalIsoDate(task.deadline)
  const isOverdue = deadline !== null && deadline < todayIsoDate()
  const canLog = task.projectId !== null
  const detail = context === "project" ? task.projectName : task.stageName

  const isDraggable =
    editing !== undefined && editing.isDraggable && !editing.isSaving
  const [isDragged, setIsDragged] = useState(false)

  return (
    <article
      className={cn(
        "grid gap-2 rounded-lg border border-l-[3px] bg-card p-3 shadow-xs transition-opacity",
        INSTANCE_EDGES[task.instanceIndex],
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragged && "opacity-40",
        editing?.isSaving && "opacity-70"
      )}
      aria-label={task.name}
      aria-busy={editing?.isSaving}
      draggable={isDraggable}
      onDragStart={(event) => {
        if (!isDraggable) return
        event.dataTransfer.effectAllowed = "move"
        // Some browsers only start a drag that carries data.
        event.dataTransfer.setData("text/plain", task.name)
        setIsDragged(true)
        editing.onDragStart(task)
      }}
      onDragEnd={() => {
        setIsDragged(false)
        editing?.onDragEnd()
      }}
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
        {editing === undefined ? (
          <TaskStatusBadge status={task.status} />
        ) : (
          <TaskStatusMenu
            status={task.status}
            options={editing.statusOptions}
            disabled={editing.isSaving}
            onChange={(status) => editing.onChangeStatus(task, status)}
          />
        )}
        {editing?.isSaving && (
          <Loader2Icon
            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            aria-label={t("kanban.moving")}
          />
        )}
        {(showInstance || editing !== undefined) && (
          <span className="ml-auto flex min-w-0 items-center gap-1">
            {showInstance && (
              <InstanceBadge instanceIndex={task.instanceIndex} />
            )}
            {editing !== undefined && task.projectId !== null && (
              <MoveMenu task={task} editing={editing} />
            )}
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
