import { useState } from "react"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { EditableTimesheet } from "@/components/timesheet/editableTimesheet"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFormatters } from "@/hooks/useFormatters"

interface DeleteTimesheetDialogProps {
  open: boolean
  timesheet: EditableTimesheet | null
  onOpenChange: (open: boolean) => void
  /** Resolves once Odoo deleted the line; a rejection is shown in the dialog. */
  onConfirm: (timesheet: EditableTimesheet) => Promise<void>
}

function DeleteTimesheetBody({
  timesheet,
  onConfirm,
}: {
  timesheet: EditableTimesheet
  onConfirm: DeleteTimesheetDialogProps["onConfirm"]
}) {
  const { t } = useTranslation()
  const { formatLongDate, formatHours } = useFormatters()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async (): Promise<void> => {
    setIsDeleting(true)
    setError(null)
    try {
      await onConfirm(timesheet)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : String(deleteError)
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("deleteTimesheet.title")}</AlertDialogTitle>
        <AlertDialogDescription>
          {t("deleteTimesheet.description", {
            hours: formatHours(timesheet.hours),
            date: formatLongDate(timesheet.date),
          })}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="grid gap-1 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="truncate font-medium" title={timesheet.label}>
          {timesheet.label}
        </span>
        <span className="line-clamp-3 text-muted-foreground">
          {timesheet.description}
        </span>
      </div>

      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="outline" disabled={isDeleting}>
            {t("common.cancel")}
          </Button>
        </AlertDialogCancel>
        {/* A plain button, not AlertDialogAction: the dialog stays open until Odoo answers. */}
        <Button
          variant="destructive"
          disabled={isDeleting}
          onClick={handleConfirm}
        >
          {isDeleting ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <Trash2Icon />
          )}
          {t("deleteTimesheet.confirm")}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/** Asks before deleting a timesheet line from Odoo. */
export function DeleteTimesheetDialog({
  open,
  timesheet,
  onOpenChange,
  onConfirm,
}: DeleteTimesheetDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {timesheet !== null && (
          <DeleteTimesheetBody
            key={`${timesheet.instanceIndex}:${timesheet.timesheetId}`}
            timesheet={timesheet}
            onConfirm={onConfirm}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
