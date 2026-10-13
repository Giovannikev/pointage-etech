import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DeleteTimesheetDialog } from "@/components/timesheet/DeleteTimesheetDialog"
import type { EditableTimesheet } from "@/components/timesheet/editableTimesheet"
import { EditTimesheetDialog } from "@/components/timesheet/EditTimesheetDialog"
import { StatusBadge } from "@/components/timesheet/StatusBadge"
import { TaskDetailsDialog } from "@/components/timesheet/TaskDetailsDialog"
import {
  EntryActions,
  EntryDescription,
  EntryHours,
  EntryInstance,
  EntryProject,
  EntryTask,
  type EntryHandlers,
} from "@/components/timesheet/TimesheetEntryParts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { useTaskDetails } from "@/hooks/useTaskDetails"
import type { TimesheetChanges, TimesheetEntry } from "@/types/timesheet"

type TimesheetTableProps = Omit<
  EntryHandlers,
  "onOpenTask" | "onEditInOdoo" | "onDeleteFromOdoo"
> & {
  entries: TimesheetEntry[]
  /** Saves an edit of a line already in Odoo; rejects with Odoo's message. */
  onUpdateInOdoo: (id: string, changes: TimesheetChanges) => Promise<void>
  /** Deletes a line from Odoo; rejects with Odoo's message. */
  onDeleteFromOdoo: (id: string) => Promise<void>
}

/** A line in Odoo, with the id of the list entry it comes from. */
type OdooLine = EditableTimesheet & { entryId: string }

function toOdooLine(entry: TimesheetEntry): OdooLine | null {
  if (entry.task === null || entry.odooTimesheetId === null) {
    return null
  }
  return {
    entryId: entry.id,
    instanceIndex: entry.task.instanceIndex,
    timesheetId: entry.odooTimesheetId,
    date: entry.date,
    hours: entry.hours,
    description: entry.description,
    label: entry.task.taskName,
  }
}

interface EntryLayoutProps extends EntryHandlers {
  entry: TimesheetEntry
}

function EntryStatus({ entry }: { entry: TimesheetEntry }) {
  return (
    <StatusBadge
      status={entry.status}
      activity={entry.activity}
      detail={entry.statusDetail}
    />
  )
}

/** A line as a card, for containers too narrow for the table. */
function TimesheetCard({ entry, ...handlers }: EntryLayoutProps) {
  const { t } = useTranslation()
  const { formatShortDate } = useFormatters()

  return (
    <li
      data-status={entry.status}
      className="grid min-w-0 content-start gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          {formatShortDate(entry.date)}
        </span>
        <EntryInstance entry={entry} />
        <div className="min-w-0 flex-1">
          <EntryProject entry={entry} />
        </div>
        <EntryStatus entry={entry} />
      </div>
      <EntryTask entry={entry} onOpenTask={handlers.onOpenTask} />
      <EntryDescription
        entry={entry}
        onDescriptionChange={handlers.onDescriptionChange}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("timesheet.columns.hours")}
          <EntryHours entry={entry} onHoursChange={handlers.onHoursChange} />
        </div>
        <EntryActions
          entry={entry}
          onVerify={handlers.onVerify}
          onSubmit={handlers.onSubmit}
          onRemove={handlers.onRemove}
          onEditInOdoo={handlers.onEditInOdoo}
          onDeleteFromOdoo={handlers.onDeleteFromOdoo}
        />
      </div>
    </li>
  )
}

/** A line as a table row, for wide containers. */
function TimesheetRow({ entry, ...handlers }: EntryLayoutProps) {
  const { formatShortDate } = useFormatters()

  return (
    <TableRow data-status={entry.status} className="align-top">
      <TableCell className="pt-3.5 whitespace-nowrap text-muted-foreground">
        {formatShortDate(entry.date)}
      </TableCell>
      <TableCell className="pt-3.5">
        <EntryInstance entry={entry} />
      </TableCell>
      <TableCell className="max-w-44 pt-3.5">
        <EntryProject entry={entry} />
      </TableCell>
      <TableCell className="max-w-56 pt-3">
        <EntryTask entry={entry} onOpenTask={handlers.onOpenTask} />
      </TableCell>
      {/* w-full + max-w-0 gives this column the remaining width and lets the
          commit message truncate instead of widening the table. */}
      <TableCell className="w-full max-w-0">
        <div className="min-w-60">
          <EntryDescription
            entry={entry}
            onDescriptionChange={handlers.onDescriptionChange}
          />
        </div>
      </TableCell>
      <TableCell>
        <EntryHours entry={entry} onHoursChange={handlers.onHoursChange} />
      </TableCell>
      <TableCell className="pt-3.5">
        <EntryStatus entry={entry} />
      </TableCell>
      <TableCell className="pt-2">
        <EntryActions
          entry={entry}
          onVerify={handlers.onVerify}
          onSubmit={handlers.onSubmit}
          onRemove={handlers.onRemove}
          onEditInOdoo={handlers.onEditInOdoo}
          onDeleteFromOdoo={handlers.onDeleteFromOdoo}
        />
      </TableCell>
    </TableRow>
  )
}

/**
 * The timesheet lines. The layout follows the width available to the list
 * (a container query), not the screen, since the sidebar takes room too:
 * cards up to 72rem, in two columns from 48rem, then a table.
 */
export function TimesheetTable({
  entries,
  onUpdateInOdoo,
  onDeleteFromOdoo,
  ...handlers
}: TimesheetTableProps) {
  const { t } = useTranslation()
  const { formatHours, formatShortDate } = useFormatters()
  const taskDetails = useTaskDetails()
  const editDialog = useDialogTarget<OdooLine>()
  const deleteDialog = useDialogTarget<OdooLine>()

  const openFor =
    (open: (line: OdooLine) => void) =>
    (entry: TimesheetEntry): void => {
      const line = toOdooLine(entry)
      if (line !== null) {
        open(line)
      }
    }

  const entryHandlers: EntryHandlers = {
    ...handlers,
    onOpenTask: taskDetails.open,
    onEditInOdoo: openFor(editDialog.open),
    onDeleteFromOdoo: openFor(deleteDialog.open),
  }

  const handleSave = async (
    line: EditableTimesheet,
    changes: TimesheetChanges
  ): Promise<void> => {
    if (editDialog.target === null) {
      return
    }
    await onUpdateInOdoo(editDialog.target.entryId, changes)
    editDialog.close()
    toast.success(t("editTimesheet.saved"), {
      description: `${formatShortDate(line.date)}: ${formatHours(changes.hours)}`,
    })
  }

  const handleDelete = async (line: EditableTimesheet): Promise<void> => {
    if (deleteDialog.target === null) {
      return
    }
    await onDeleteFromOdoo(deleteDialog.target.entryId)
    deleteDialog.close()
    toast.success(t("deleteTimesheet.deleted"), {
      description: t("deleteTimesheet.backInList", {
        hours: formatHours(line.hours),
      }),
    })
  }

  return (
    <div className="@container">
      <ul className="grid gap-3 @3xl:grid-cols-2 @6xl:hidden">
        {entries.map((entry) => (
          <TimesheetCard key={entry.id} entry={entry} {...entryHandlers} />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border bg-card @6xl:block">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">
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
                <span className="sr-only">
                  {t("timesheet.columns.actions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TimesheetRow key={entry.id} entry={entry} {...entryHandlers} />
            ))}
          </TableBody>
        </Table>
      </div>

      <TaskDetailsDialog
        state={taskDetails.state}
        onClose={taskDetails.close}
      />
      <EditTimesheetDialog
        open={editDialog.isOpen}
        timesheet={editDialog.target}
        onOpenChange={(open) => !open && editDialog.close()}
        onSave={handleSave}
      />
      <DeleteTimesheetDialog
        open={deleteDialog.isOpen}
        timesheet={deleteDialog.target}
        onOpenChange={(open) => !open && deleteDialog.close()}
        onConfirm={handleDelete}
      />
    </div>
  )
}
