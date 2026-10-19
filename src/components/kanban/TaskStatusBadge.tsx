import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

interface TaskStatusMenuProps {
  status: KanbanTaskStatus | null
  /** States the task's instance accepts; none: the badge isn't clickable. */
  options: KanbanTaskStatus[]
  disabled?: boolean
  onChange: (status: KanbanTaskStatus) => void
}

/**
 * The task's state, clickable to set another one in Odoo. "In progress"
 * shows as a plain dot, as on Odoo's cards, so every card has a target.
 */
export function TaskStatusMenu({
  status,
  options,
  disabled = false,
  onChange,
}: TaskStatusMenuProps) {
  const { t } = useTranslation()
  if (options.length === 0) {
    return <TaskStatusBadge status={status} />
  }
  const current = status ?? "in_progress"
  const label = t(`kanban.status.${current}`)
  const isQuiet = current === "in_progress"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("kanban.changeStatus", { status: label })}
          title={t("kanban.changeStatus", { status: label })}
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted",
            current === "blocked" && "font-medium text-destructive"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "rounded-full",
              isQuiet ? "size-2 ring-1 ring-muted-foreground/60" : "size-1.5",
              STATUS_DOTS[current]
            )}
          />
          {!isQuiet && label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{t("kanban.statusMenu")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            const next = options.find((option) => option === value)
            if (next !== undefined && next !== current) {
              onChange(next)
            }
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <span
                aria-hidden
                className={cn("size-2 rounded-full", STATUS_DOTS[option])}
              />
              {t(`kanban.status.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
