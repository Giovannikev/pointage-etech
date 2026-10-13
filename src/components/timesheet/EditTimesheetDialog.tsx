import { useId, useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { EditableTimesheet } from "@/components/timesheet/editableTimesheet"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFormatters } from "@/hooks/useFormatters"
import type { TimesheetChanges } from "@/types/timesheet"
import {
  HOURS_STEP,
  isValidHours,
  MAX_HOURS,
  MIN_HOURS,
} from "@/utils/timesheetRules"

interface EditTimesheetDialogProps {
  open: boolean
  timesheet: EditableTimesheet | null
  onOpenChange: (open: boolean) => void
  /** Resolves once Odoo saved the line; a rejection is shown in the dialog. */
  onSave: (
    timesheet: EditableTimesheet,
    changes: TimesheetChanges
  ) => Promise<void>
}

interface EditTimesheetFormProps {
  timesheet: EditableTimesheet
  onSave: EditTimesheetDialogProps["onSave"]
}

function EditTimesheetForm({ timesheet, onSave }: EditTimesheetFormProps) {
  const { t } = useTranslation()
  const { formatLongDate } = useFormatters()
  const fieldId = useId()
  const [hours, setHours] = useState(String(timesheet.hours))
  const [description, setDescription] = useState(timesheet.description)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedHours = Number(hours)
  const hoursValid = isValidHours(parsedHours)
  const descriptionValid = description.trim() !== ""
  const isUnchanged =
    parsedHours === timesheet.hours &&
    description.trim() === timesheet.description.trim()
  const canSave = hoursValid && descriptionValid && !isUnchanged && !isSaving

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSave) {
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await onSave(timesheet, {
        hours: parsedHours,
        description: description.trim(),
      })
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError)
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("editTimesheet.title")}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          <InstanceBadge instanceIndex={timesheet.instanceIndex} />
          <span>{formatLongDate(timesheet.date)}</span>
        </DialogDescription>
      </DialogHeader>

      <p className="truncate font-medium" title={timesheet.label}>
        {timesheet.label}
      </p>

      <div className="grid gap-2 sm:max-w-32">
        <Label htmlFor={`${fieldId}-hours`}>{t("editTimesheet.hours")}</Label>
        <Input
          id={`${fieldId}-hours`}
          type="number"
          inputMode="decimal"
          min={MIN_HOURS}
          max={MAX_HOURS}
          step={HOURS_STEP}
          value={hours}
          aria-invalid={!hoursValid}
          className="text-right tabular-nums"
          onChange={(event) => setHours(event.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-description`}>
          {t("editTimesheet.description")}
        </Label>
        <Textarea
          id={`${fieldId}-description`}
          value={description}
          aria-invalid={!descriptionValid}
          className="min-h-24"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isSaving}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSave}>
          {isSaving && <Loader2Icon className="animate-spin" />}
          {t("editTimesheet.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Edits the hours and description of a timesheet line already in Odoo. */
export function EditTimesheetDialog({
  open,
  timesheet,
  onOpenChange,
  onSave,
}: EditTimesheetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {timesheet !== null && (
          // Keyed so the fields start from the line's values on each open.
          <EditTimesheetForm
            key={`${timesheet.instanceIndex}:${timesheet.timesheetId}`}
            timesheet={timesheet}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
