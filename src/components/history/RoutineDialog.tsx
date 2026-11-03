import { useId, useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

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
import {
  createRoutine,
  notifyRoutinesChanged,
  updateRoutine,
  type NewTimesheetRoutine,
  type TimesheetRoutine,
} from "@/services/timesheetRoutineService"
import {
  HOURS_STEP,
  isValidHours,
  MAX_HOURS,
  MIN_HOURS,
} from "@/utils/timesheetRules"

/** A routine to create from a timesheet line, or one to change. */
export type RoutineTarget = NewTimesheetRoutine | TimesheetRoutine

function isSaved(target: RoutineTarget): target is TimesheetRoutine {
  return "id" in target
}

interface RoutineDialogProps {
  open: boolean
  target: RoutineTarget | null
  onOpenChange: (open: boolean) => void
  /** Called once the routine is saved. */
  onSaved: () => void
}

function RoutineForm({
  target,
  onSaved,
}: {
  target: RoutineTarget
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const [logAt, setLogAt] = useState(target.logAt)
  const [hours, setHours] = useState(String(target.hours))
  const [description, setDescription] = useState(target.description)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedHours = Number(hours)
  const hoursValid = isValidHours(parsedHours)
  const descriptionValid = description.trim() !== ""
  const timeValid = /^\d{2}:\d{2}$/.test(logAt)
  const canSave = hoursValid && descriptionValid && timeValid && !isSaving

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSave) {
      return
    }
    setIsSaving(true)
    setError(null)
    const values = {
      logAt,
      hours: parsedHours,
      description: description.trim(),
    }
    try {
      if (isSaved(target)) {
        await updateRoutine(target.id, values)
      } else {
        await createRoutine({ ...target, ...values })
      }
      notifyRoutinesChanged()
      onSaved()
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
        <DialogTitle>
          {isSaved(target)
            ? t("routines.editTitle")
            : t("routines.createTitle")}
        </DialogTitle>
        <DialogDescription>{t("routines.dialogHint")}</DialogDescription>
      </DialogHeader>

      <div className="flex min-w-0 items-center gap-2">
        <InstanceBadge instanceIndex={target.instanceIndex} />
        <div className="grid min-w-0">
          {target.projectName !== null && (
            <span className="truncate text-xs text-muted-foreground">
              {target.projectName}
            </span>
          )}
          <span className="truncate font-medium" title={target.taskName}>
            {target.taskName}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:max-w-72">
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-time`}>{t("routines.time")}</Label>
          <Input
            id={`${fieldId}-time`}
            type="time"
            value={logAt}
            aria-invalid={!timeValid}
            onChange={(event) => setLogAt(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-hours`}>{t("routines.hours")}</Label>
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
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-description`}>
          {t("routines.description")}
        </Label>
        <Textarea
          id={`${fieldId}-description`}
          value={description}
          aria-invalid={!descriptionValid}
          className="min-h-20"
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
          {t("routines.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Sets the time, hours and description of a line logged every working day. */
export function RoutineDialog({
  open,
  target,
  onOpenChange,
  onSaved,
}: RoutineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {target !== null && (
          // Keyed so the fields start from the target's values on each open.
          <RoutineForm
            key={isSaved(target) ? target.id : `${target.taskId}`}
            target={target}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
