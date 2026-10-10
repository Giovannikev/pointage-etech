import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  RotateCwIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { HoursInput } from "@/components/timesheet/HoursInput"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useFormatters } from "@/hooks/useFormatters"
import type { OdooTaskMatch, TimesheetEntry } from "@/types/timesheet"
import {
  canVerify,
  isEditable,
  isInOdoo,
  isSubmittable,
} from "@/utils/timesheetRules"

/**
 * Pieces of a timesheet line, laid out as a table row on wide containers and
 * as a card on narrow ones (see TimesheetTable).
 */

export interface EntryHandlers {
  onOpenTask: (task: OdooTaskMatch) => void
  onDescriptionChange: (id: string, description: string) => void
  onHoursChange: (id: string, hours: number) => void
  onVerify: (id: string) => void
  onSubmit: (id: string) => void
  onRemove: (id: string) => void
}

interface EntryProps {
  entry: TimesheetEntry
}

function isWaitingForTask(entry: TimesheetEntry): boolean {
  return entry.task === null && entry.activity === "verifying"
}

/** Accessible name of a line: its task reference, or its commit message. */
function lineLabel(entry: TimesheetEntry): string {
  return entry.commit.taskRef ?? entry.commit.rawMessage
}

export function EntryInstance({ entry }: EntryProps) {
  if (isWaitingForTask(entry)) {
    return <Skeleton className="h-5 w-20 rounded-4xl" />
  }
  return <InstanceBadge instanceIndex={entry.task?.instanceIndex ?? null} />
}

export function EntryProject({ entry }: EntryProps) {
  if (isWaitingForTask(entry)) {
    return <Skeleton className="h-4 w-28" />
  }
  return (
    <span className="block truncate" title={entry.task?.projectName}>
      {entry.task?.projectName ?? (
        <span className="text-muted-foreground">—</span>
      )}
    </span>
  )
}

export function EntryTask({
  entry,
  onOpenTask,
}: EntryProps & Pick<EntryHandlers, "onOpenTask">) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const { task } = entry

  return (
    <div className="min-w-0">
      <span className="block font-mono text-xs text-muted-foreground">
        {entry.commit.taskRef ?? t("timesheet.noReference")}
      </span>
      {isWaitingForTask(entry) ? (
        <Skeleton className="mt-1 h-4 w-32" />
      ) : (
        task !== null && (
          <>
            <button
              type="button"
              className="block max-w-full truncate rounded-sm text-left underline decoration-dotted underline-offset-4 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
              title={t("timesheet.showDetails", { name: task.taskName })}
              onClick={() => onOpenTask(task)}
            >
              {task.taskName}
            </button>
            {entry.status === "found" && entry.loggedHours > 0 && (
              <span
                className="mt-1 flex items-center gap-1 text-xs font-medium text-warning"
                title={t("timesheet.loggedThatDayHint")}
              >
                <TriangleAlertIcon className="size-3.5 shrink-0" />
                {t("timesheet.loggedThatDay", {
                  hours: formatHours(entry.loggedHours),
                })}
              </span>
            )}
          </>
        )
      )}
    </div>
  )
}

export function EntryDescription({
  entry,
  onDescriptionChange,
}: EntryProps & Pick<EntryHandlers, "onDescriptionChange">) {
  const { t } = useTranslation()
  const editable = isEditable(entry)

  return (
    <div className="min-w-0">
      <Input
        value={entry.description}
        disabled={!editable}
        title={entry.description}
        aria-label={t("timesheet.descriptionFor", { line: lineLabel(entry) })}
        aria-invalid={editable && entry.description.trim() === ""}
        placeholder={t("timesheet.descriptionPlaceholder")}
        onChange={(event) => onDescriptionChange(entry.id, event.target.value)}
      />
      <p
        className="mt-1.5 truncate px-0.5 font-mono text-xs text-muted-foreground"
        title={entry.commit.rawMessage}
      >
        {entry.commit.rawMessage}
      </p>
    </div>
  )
}

export function EntryHours({
  entry,
  onHoursChange,
}: EntryProps & Pick<EntryHandlers, "onHoursChange">) {
  const { t } = useTranslation()
  return (
    <HoursInput
      value={entry.hours}
      disabled={!isEditable(entry)}
      label={t("timesheet.hoursFor", { line: lineLabel(entry) })}
      onCommit={(hours) => onHoursChange(entry.id, hours)}
    />
  )
}

interface RowActionProps {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
  destructive?: boolean
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
  destructive = false,
}: RowActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={
            destructive
              ? "text-muted-foreground hover:text-destructive"
              : "text-muted-foreground"
          }
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function EntryActions({
  entry,
  onVerify,
  onSubmit,
  onRemove,
}: EntryProps & Pick<EntryHandlers, "onVerify" | "onSubmit" | "onRemove">) {
  const { t } = useTranslation()

  return (
    <div className="flex justify-end gap-0.5">
      <RowAction
        label={t("timesheet.checkAgain")}
        disabled={!canVerify(entry)}
        onClick={() => onVerify(entry.id)}
      >
        <RotateCwIcon />
      </RowAction>
      <RowAction
        label={t("timesheet.submitLine")}
        disabled={!isSubmittable(entry)}
        onClick={() => onSubmit(entry.id)}
      >
        <SendIcon />
      </RowAction>
      <RowAction
        label={
          isInOdoo(entry)
            ? t("timesheet.removeLoggedLine")
            : t("timesheet.removeLine")
        }
        disabled={entry.activity !== "idle"}
        onClick={() => onRemove(entry.id)}
        destructive
      >
        <Trash2Icon />
      </RowAction>
    </div>
  )
}
