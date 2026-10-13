import { Fragment } from "react"
import {
  CircleCheckIcon,
  EllipsisIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useFormatters } from "@/hooks/useFormatters"
import type { TimesheetHistoryEntry } from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import type { HistoryDay } from "@/utils/history"
import { roundHours, WORKDAY_HOURS } from "@/utils/timesheetRules"

interface HistoryTableProps {
  days: HistoryDay[]
  onEdit: (entry: TimesheetHistoryEntry) => void
  onDelete: (entry: TimesheetHistoryEntry) => void
  /** Logs the missing hours of a short day. */
  onCompleteDay: (day: HistoryDay) => void
}

type EntryActionsProps = Pick<HistoryTableProps, "onEdit" | "onDelete"> & {
  entry: TimesheetHistoryEntry
}

function entryKey(entry: TimesheetHistoryEntry): string {
  return `${entry.instanceIndex}:${entry.timesheetId}`
}

function EntryActions({ entry, onEdit, onDelete }: EntryActionsProps) {
  const { t } = useTranslation()
  if (entry.locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={t("history.locked")}
          >
            <LockIcon className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("history.locked")}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t("history.actionsFor", {
            line: entry.ticketName ?? entry.taskName ?? entry.description,
          })}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => onEdit(entry)}>
          <PencilIcon />
          {t("history.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => onDelete(entry)}
        >
          <Trash2Icon />
          {t("history.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The day's total against the workday target, with a way to complete it. */
function DayTotal({
  day,
  onCompleteDay,
}: {
  day: HistoryDay
  onCompleteDay: HistoryTableProps["onCompleteDay"]
}) {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  const missing = roundHours(WORKDAY_HOURS - day.hours)
  const canComplete = missing > 0 && day.date <= todayIsoDate()
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="font-semibold">{formatHours(day.hours)}</span>
      {missing <= 0 ? (
        <CircleCheckIcon
          className="size-4 text-success"
          aria-label={t("history.dayComplete")}
        />
      ) : (
        <span className="text-xs font-medium text-warning">
          {t("history.dayShort", { hours: formatHours(missing) })}
        </span>
      )}
      {canComplete && (
        <Button
          variant="outline"
          size="xs"
          aria-label={t("completeDay.buttonFor", {
            date: formatShortDate(day.date),
          })}
          onClick={() => onCompleteDay(day)}
        >
          <PlusIcon />
          {t("completeDay.button")}
        </Button>
      )}
    </span>
  )
}

function TaskCell({ entry }: { entry: TimesheetHistoryEntry }) {
  return (
    <div className="min-w-0">
      <span
        className="block truncate text-xs text-muted-foreground"
        title={entry.projectName ?? undefined}
      >
        {entry.projectName ?? "—"}
      </span>
      <span
        className="block truncate"
        title={entry.ticketName ?? entry.taskName ?? undefined}
      >
        {entry.ticketName ?? entry.taskName ?? "—"}
      </span>
    </div>
  )
}

/**
 * The period's timesheets grouped by day. Like the timesheet table, it
 * follows the width of its container: cards when narrow, a table when wide.
 */
export function HistoryTable({
  days,
  onEdit,
  onDelete,
  onCompleteDay,
}: HistoryTableProps) {
  const { t } = useTranslation()
  const { formatHours, formatLongDate } = useFormatters()

  return (
    <div className="@container">
      <div className="grid gap-5 @4xl:hidden">
        {days.map((day) => (
          <section key={day.date} className="grid gap-2">
            <header className="flex items-center justify-between gap-3 px-1">
              <h3 className="text-sm font-semibold first-letter:uppercase">
                {formatLongDate(day.date)}
              </h3>
              <DayTotal day={day} onCompleteDay={onCompleteDay} />
            </header>
            <ul className="grid gap-2">
              {day.entries.map((entry) => (
                <li
                  key={entryKey(entry)}
                  className="grid gap-2 rounded-xl border bg-card p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <TaskCell entry={entry} />
                    </div>
                    <EntryActions
                      entry={entry}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {entry.description}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <InstanceBadge instanceIndex={entry.instanceIndex} />
                    <span className="font-medium tabular-nums">
                      {formatHours(entry.hours)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card @4xl:block">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-28">
                {t("timesheet.columns.instance")}
              </TableHead>
              <TableHead className="w-64">
                {t("timesheet.columns.task")}
              </TableHead>
              <TableHead>{t("timesheet.columns.description")}</TableHead>
              <TableHead className="w-24 text-right">
                {t("timesheet.columns.hours")}
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">
                  {t("timesheet.columns.actions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <Fragment key={day.date}>
                <TableRow className="bg-muted/25 hover:bg-muted/25">
                  <TableCell
                    colSpan={3}
                    className="font-semibold first-letter:uppercase"
                  >
                    {formatLongDate(day.date)}
                  </TableCell>
                  <TableCell colSpan={2} className="text-right">
                    <DayTotal day={day} onCompleteDay={onCompleteDay} />
                  </TableCell>
                </TableRow>
                {day.entries.map((entry) => (
                  <TableRow key={entryKey(entry)} className="align-top">
                    <TableCell className="pt-3">
                      <InstanceBadge instanceIndex={entry.instanceIndex} />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <TaskCell entry={entry} />
                    </TableCell>
                    {/* w-full + max-w-0 lets the description wrap instead of widening the table. */}
                    <TableCell className="w-full max-w-0 pt-3">
                      <p className="line-clamp-2 whitespace-normal">
                        {entry.description}
                      </p>
                    </TableCell>
                    <TableCell className="pt-3 text-right font-medium tabular-nums">
                      {formatHours(entry.hours)}
                    </TableCell>
                    <TableCell className="pt-1.5">
                      <EntryActions
                        entry={entry}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
