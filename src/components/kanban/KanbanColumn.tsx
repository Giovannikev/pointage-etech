import { useState, type DragEvent } from "react"
import { ChevronsLeftRightIcon, ChevronsRightLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { KanbanCard, type CardEditing } from "@/components/kanban/KanbanCard"
import { TicketCard } from "@/components/tasks/TicketCard"
import {
  taskTarget,
  ticketTarget,
  type LogTarget,
} from "@/components/timesheet/logTarget"
import { Button } from "@/components/ui/button"
import { useFormatters } from "@/hooks/useFormatters"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { KanbanStage, KanbanTask } from "@/types/timesheet"
import { cardKey, type BoardColumn } from "@/utils/kanban"

interface KanbanColumnProps {
  column: BoardColumn
  isCollapsed: boolean
  showInstance: boolean
  onToggleCollapsed: (key: string) => void
  onOpenTask: (task: KanbanTask) => void
  /** Logs time on a task or a ticket of the column. */
  onLogTime: (target: LogTarget) => void
  /** Editing of the column's tasks; read only without it. */
  cardEditing?: (task: KanbanTask) => CardEditing
  /** Set while a card is dragged over the board. */
  drop?: ColumnDrop
}

/** What the dragged card would become in this column. */
export interface ColumnDrop {
  /** The stage of the card's project behind this column; null: no drop. */
  stage: KanbanStage | null
  /** The column the card comes from: neither a target nor dimmed. */
  isSource: boolean
  onDrop: (stage: KanbanStage) => void
}

/** Native drag and drop: the column accepts the card when it has a stage for it. */
function useDropZone(drop: ColumnDrop | undefined) {
  const [isOver, setIsOver] = useState(false)
  const stage = drop?.stage ?? null
  const handlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (stage === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      setIsOver(true)
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      // Leaving for a child of the column isn't leaving the column.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setIsOver(false)
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      setIsOver(false)
      if (stage !== null) drop?.onDrop(stage)
    },
  }
  const isTarget = stage !== null
  return {
    handlers,
    isOver: isOver && isTarget,
    className: cn(
      "transition-[opacity,background-color,outline-color]",
      isTarget &&
        "outline-2 -outline-offset-2 outline-primary/40 outline-dashed",
      isOver && isTarget && "bg-primary/5 outline-primary outline-solid",
      drop !== undefined && !isTarget && !drop.isSource && "opacity-45"
    ),
    title:
      drop === undefined || drop.isSource
        ? undefined
        : stage === null
          ? "kanban.noDropHint"
          : "kanban.dropHere",
  } as const
}

export function KanbanColumn({
  column,
  isCollapsed,
  showInstance,
  onToggleCollapsed,
  onOpenTask,
  onLogTime,
  cardEditing,
  drop,
}: KanbanColumnProps) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const zone = useDropZone(drop)
  const dropTitle =
    zone.title === undefined
      ? undefined
      : t(zone.title, { stage: drop?.stage?.name ?? "" })
  const name =
    column.name ??
    (column.kind === "project"
      ? t("kanban.projectFilter.noProject")
      : t("kanban.noStage"))
  const count = column.cards.length
  const instanceDot = showInstance && column.instanceIndex !== null && (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        INSTANCE_BACKGROUNDS[column.instanceIndex]
      )}
    />
  )

  if (isCollapsed) {
    // Folded like in Odoo: a narrow strip with the name written vertically.
    return (
      <section
        aria-label={name}
        className={cn("shrink-0 rounded-xl", zone.className)}
        title={dropTitle}
        {...zone.handlers}
      >
        <button
          type="button"
          className="flex h-64 w-11 flex-col items-center gap-3 rounded-xl bg-muted/50 py-3 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-expanded={false}
          title={t("kanban.expandColumn", { name })}
          onClick={() => onToggleCollapsed(column.key)}
        >
          <ChevronsLeftRightIcon className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
            {count}
          </span>
          <span className="min-h-0 truncate font-medium [writing-mode:vertical-rl]">
            {name}
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      aria-label={name}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 sm:w-80",
        zone.className
      )}
      title={dropTitle}
      {...zone.handlers}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        {instanceDot}
        <h3 className="min-w-0 truncate text-sm font-semibold" title={name}>
          {name}
        </h3>
        <span className="rounded-full bg-background px-1.5 text-xs font-semibold text-muted-foreground tabular-nums">
          {count}
        </span>
        {column.effectiveHours > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatHours(column.effectiveHours)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto text-muted-foreground"
          aria-label={t("kanban.collapseColumn", { name })}
          aria-expanded
          onClick={() => onToggleCollapsed(column.key)}
        >
          <ChevronsRightLeftIcon />
        </Button>
      </header>
      <ul className="grid max-h-[calc(100svh-17rem)] min-h-24 content-start gap-2 overflow-y-auto px-2 pb-2">
        {column.cards.map((card) => (
          <li key={cardKey(card)}>
            {card.kind === "task" ? (
              <KanbanCard
                task={card.task}
                showInstance={showInstance}
                context={column.kind === "project" ? "stage" : "project"}
                onOpenTask={onOpenTask}
                onLogTime={(task) => onLogTime(taskTarget(task))}
                editing={cardEditing?.(card.task)}
              />
            ) : (
              <TicketCard
                ticket={card.ticket}
                showInstance={showInstance}
                onLogTime={(ticket) => onLogTime(ticketTarget(ticket))}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
