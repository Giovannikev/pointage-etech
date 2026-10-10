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
import { StatusBadge } from "@/components/timesheet/StatusBadge"
import { TaskDetailsDialog } from "@/components/timesheet/TaskDetailsDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useFormatters } from "@/hooks/useFormatters"
import { useTaskDetails } from "@/hooks/useTaskDetails"
import type { OdooTaskMatch, TimesheetEntry } from "@/types/timesheet"
import {
  canVerify,
  isEditable,
  isInOdoo,
  isSubmittable,
} from "@/utils/timesheetRules"

interface TimesheetTableProps {
  entries: TimesheetEntry[]
  onDescriptionChange: (id: string, description: string) => void
  onHoursChange: (id: string, hours: number) => void
  onVerify: (id: string) => void
  onSubmit: (id: string) => void
  onRemove: (id: string) => void
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

function InstanceCell({ entry }: { entry: TimesheetEntry }) {
  if (entry.task === null && entry.activity === "verifying") {
    return <Skeleton className="h-5 w-20 rounded-4xl" />
  }
  return <InstanceBadge instanceIndex={entry.task?.instanceIndex ?? null} />
}

function TimesheetRow({
  entry,
  onOpenTask,
  onDescriptionChange,
  onHoursChange,
  onVerify,
  onSubmit,
  onRemove,
}: Omit<TimesheetTableProps, "entries"> & {
  entry: TimesheetEntry
  onOpenTask: (task: OdooTaskMatch) => void
}) {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  const { commit, task } = entry
  const editable = isEditable(entry)
  const rowLabel = commit.taskRef ?? commit.rawMessage
  const isWaitingForTask = task === null && entry.activity === "verifying"

  return (
    <TableRow data-status={entry.status} className="align-top">
      <TableCell className="pt-3.5 whitespace-nowrap text-muted-foreground">
        {formatShortDate(entry.date)}
      </TableCell>

      <TableCell className="pt-3.5">
        <InstanceCell entry={entry} />
      </TableCell>

      <TableCell className="max-w-48 pt-3.5">
        {isWaitingForTask ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <span className="block truncate" title={task?.projectName}>
            {task?.projectName ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        )}
      </TableCell>

      <TableCell className="max-w-56 pt-3">
        <span className="block font-mono text-xs text-muted-foreground">
          {commit.taskRef ?? t("timesheet.noReference")}
        </span>
        {isWaitingForTask ? (
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
      </TableCell>

      {/* w-full + max-w-0 lets this column take the remaining width
          and truncate the commit message instead of widening the table. */}
      <TableCell className="w-full max-w-0">
        <div className="min-w-72">
          <Input
            value={entry.description}
            disabled={!editable}
            aria-label={t("timesheet.descriptionFor", { line: rowLabel })}
            aria-invalid={editable && entry.description.trim() === ""}
            placeholder={t("timesheet.descriptionPlaceholder")}
            onChange={(event) =>
              onDescriptionChange(entry.id, event.target.value)
            }
          />
          <p
            className="mt-1.5 truncate px-0.5 font-mono text-xs text-muted-foreground"
            title={commit.rawMessage}
          >
            {commit.rawMessage}
          </p>
        </div>
      </TableCell>

      <TableCell>
        <HoursInput
          value={entry.hours}
          disabled={!editable}
          label={t("timesheet.hoursFor", { line: rowLabel })}
          onCommit={(hours) => onHoursChange(entry.id, hours)}
        />
      </TableCell>

      <TableCell className="pt-3.5">
        <StatusBadge
          status={entry.status}
          activity={entry.activity}
          detail={entry.statusDetail}
        />
      </TableCell>

      <TableCell className="pt-2">
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
      </TableCell>
    </TableRow>
  )
}

export function TimesheetTable({ entries, ...handlers }: TimesheetTableProps) {
  const { t } = useTranslation()
  const taskDetails = useTaskDetails()

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28">
              {t("timesheet.columns.date")}
            </TableHead>
            <TableHead className="w-28">
              {t("timesheet.columns.instance")}
            </TableHead>
            <TableHead>{t("timesheet.columns.project")}</TableHead>
            <TableHead>{t("timesheet.columns.task")}</TableHead>
            <TableHead>{t("timesheet.columns.description")}</TableHead>
            <TableHead className="w-24 text-right">
              {t("timesheet.columns.hours")}
            </TableHead>
            <TableHead className="w-32">
              {t("timesheet.columns.status")}
            </TableHead>
            <TableHead className="w-28">
              <span className="sr-only">{t("timesheet.columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TimesheetRow
              key={entry.id}
              entry={entry}
              onOpenTask={taskDetails.open}
              {...handlers}
            />
          ))}
        </TableBody>
      </Table>
      <TaskDetailsDialog
        state={taskDetails.state}
        onClose={taskDetails.close}
      />
    </div>
  )
}
