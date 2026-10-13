import { useId, useState, type FormEvent } from "react"
import { Loader2Icon, TimerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { DatePicker } from "@/components/timesheet/DatePicker"
import { DayLoadNotice } from "@/components/timesheet/DayLoadNotice"
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
import { logTime } from "@/services/odooService"
import type { KanbanTask } from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import { splitTaskName } from "@/utils/kanban"
import {
  HOURS_STEP,
  isValidHours,
  MAX_HOURS,
  MIN_HOURS,
} from "@/utils/timesheetRules"

const DEFAULT_HOURS = "1"

/** What was logged, for the confirmation toast. */
export interface QuickLogResult {
  task: KanbanTask
  hours: number
  date: string
}

interface QuickLogDialogProps {
  open: boolean
  task: KanbanTask | null
  onOpenChange: (open: boolean) => void
  onLogged: (result: QuickLogResult) => void
}

function QuickLogForm({
  task,
  onLogged,
}: {
  task: KanbanTask
  onLogged: QuickLogDialogProps["onLogged"]
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const [date, setDate] = useState(todayIsoDate)
  const [hours, setHours] = useState(DEFAULT_HOURS)
  const [description, setDescription] = useState("")
  const [isLogging, setIsLogging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedHours = Number(hours)
  const hoursValid = isValidHours(parsedHours)
  const canLog =
    task.projectId !== null &&
    hoursValid &&
    description.trim() !== "" &&
    !isLogging

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canLog || task.projectId === null) {
      return
    }
    setIsLogging(true)
    setError(null)
    try {
      await logTime({
        clientId: crypto.randomUUID(),
        taskId: task.taskId,
        projectId: task.projectId,
        hours: parsedHours,
        description: description.trim(),
        date,
        instanceIndex: task.instanceIndex,
      })
      onLogged({ task, hours: parsedHours, date })
    } catch (logError) {
      setError(logError instanceof Error ? logError.message : String(logError))
      setIsLogging(false)
    }
  }

  const { ref, title } = splitTaskName(task.name)

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("quickLog.title")}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InstanceBadge instanceIndex={task.instanceIndex} />
            {task.projectName !== null && (
              <span className="truncate">{task.projectName}</span>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      <p className="leading-snug font-medium">
        {ref !== null && (
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            [{ref}]
          </span>
        )}
        {title}
      </p>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-date`}>{t("quickLog.date")}</Label>
          <DatePicker id={`${fieldId}-date`} value={date} onChange={setDate} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-hours`}>{t("quickLog.hours")}</Label>
          <Input
            id={`${fieldId}-hours`}
            type="number"
            inputMode="decimal"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={HOURS_STEP}
            value={hours}
            aria-invalid={!hoursValid}
            className="w-24 text-right tabular-nums"
            onChange={(event) => setHours(event.target.value)}
          />
        </div>
      </div>

      <DayLoadNotice
        date={date}
        instanceIndex={task.instanceIndex}
        taskId={task.taskId}
        hours={hoursValid ? parsedHours : 0}
        description={description}
      />

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-description`}>
          {t("quickLog.description")}
        </Label>
        <Textarea
          id={`${fieldId}-description`}
          value={description}
          placeholder={t("timesheet.descriptionPlaceholder")}
          autoFocus
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
          <Button type="button" variant="outline" disabled={isLogging}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canLog}>
          {isLogging ? <Loader2Icon className="animate-spin" /> : <TimerIcon />}
          {t("quickLog.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Logs time on a task straight from its Kanban card. */
export function QuickLogDialog({
  open,
  task,
  onOpenChange,
  onLogged,
}: QuickLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {task !== null && (
          <QuickLogForm
            key={`${task.instanceIndex}:${task.taskId}`}
            task={task}
            onLogged={onLogged}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
