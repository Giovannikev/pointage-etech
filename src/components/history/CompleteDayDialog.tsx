import { useCallback, useId, useMemo, useState, type FormEvent } from "react"
import { CheckIcon, Loader2Icon, SearchIcon, TimerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { DayLoadNotice } from "@/components/timesheet/DayLoadNotice"
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
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import { fetchMyTasks, logTime, peekMyTasks } from "@/services/odooService"
import type {
  MyTasksInstanceResult,
  TimesheetHistoryEntry,
} from "@/types/timesheet"
import { listLoggableTasks, type LoggableTask } from "@/utils/history"
import { normalizeText } from "@/utils/kanban"
import {
  HOURS_STEP,
  isValidHours,
  MAX_HOURS,
  MIN_HOURS,
} from "@/utils/timesheetRules"

/** A short day to complete. */
export interface DayToComplete {
  /** YYYY-MM-DD */
  date: string
  missingHours: number
}

interface CompleteDayDialogProps {
  open: boolean
  day: DayToComplete | null
  /** The loaded history: its tasks are offered first. */
  entries: TimesheetHistoryEntry[]
  onOpenChange: (open: boolean) => void
  onLogged: (day: DayToComplete, hours: number) => void
}

function taskKey(task: LoggableTask): string {
  return `${task.instanceIndex}:${task.taskId}`
}

interface TaskPickerProps {
  tasks: LoggableTask[]
  isLoading: boolean
  value: LoggableTask | null
  onChange: (task: LoggableTask) => void
}

function TaskPicker({ tasks, isLoading, value, onChange }: TaskPickerProps) {
  const { t } = useTranslation()
  const listId = useId()
  const [search, setSearch] = useState("")
  const visible = useMemo(() => {
    const words = normalizeText(search).split(/\s+/).filter(Boolean)
    return tasks.filter((task) => {
      const text = normalizeText(`${task.name} ${task.projectName ?? ""}`)
      return words.every((word) => text.includes(word))
    })
  }, [tasks, search])

  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          placeholder={t("completeDay.searchTask")}
          aria-label={t("completeDay.searchTask")}
          aria-controls={listId}
          className="pl-8"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ul
        id={listId}
        aria-label={t("completeDay.task")}
        className="grid max-h-52 overflow-y-auto rounded-lg border p-1"
      >
        {visible.map((task, position) => {
          const isSelected = value !== null && taskKey(value) === taskKey(task)
          const startsOthers =
            !task.isRecent && (position === 0 || visible[position - 1].isRecent)
          return (
            <li key={taskKey(task)}>
              {startsOthers && (
                <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
                  {t("completeDay.otherTasks")}
                </p>
              )}
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSelected && "bg-muted"
                )}
                onClick={() => onChange(task)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    INSTANCE_BACKGROUNDS[task.instanceIndex]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{task.name}</span>
                  {task.projectName !== null && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {task.projectName}
                    </span>
                  )}
                </span>
                {isSelected && <CheckIcon className="size-4 shrink-0" />}
              </button>
            </li>
          )
        })}
        {isLoading && (
          <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("completeDay.loadingTasks")}
          </li>
        )}
        {!isLoading && visible.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t("completeDay.noTask")}
          </li>
        )}
      </ul>
    </div>
  )
}

function CompleteDayForm({
  day,
  entries,
  onLogged,
}: {
  day: DayToComplete
  entries: TimesheetHistoryEntry[]
  onLogged: CompleteDayDialogProps["onLogged"]
}) {
  const { t } = useTranslation()
  const { formatLongDate, formatHours } = useFormatters()
  const fieldId = useId()
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchMyTasks({ force }),
    []
  )
  const myTasks = useCachedQuery<MyTasksInstanceResult[]>(
    "myTasks",
    fetcher,
    peekMyTasks
  )
  const tasks = useMemo(
    () =>
      listLoggableTasks(
        entries,
        (myTasks.data ?? []).flatMap((result) =>
          result.ok ? result.tasks : []
        )
      ),
    [entries, myTasks.data]
  )

  const [task, setTask] = useState<LoggableTask | null>(null)
  const [hours, setHours] = useState(String(day.missingHours))
  const [description, setDescription] = useState("")
  const [isLogging, setIsLogging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedHours = Number(hours)
  const hoursValid = isValidHours(parsedHours)
  const canLog =
    task !== null && hoursValid && description.trim() !== "" && !isLogging

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canLog || task === null) {
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
        date: day.date,
        instanceIndex: task.instanceIndex,
      })
      onLogged(day, parsedHours)
    } catch (logError) {
      setError(logError instanceof Error ? logError.message : String(logError))
      setIsLogging(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("completeDay.title")}</DialogTitle>
        <DialogDescription>
          {t("completeDay.description", {
            date: formatLongDate(day.date),
            hours: formatHours(day.missingHours),
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label>{t("completeDay.task")}</Label>
        <TaskPicker
          tasks={tasks}
          isLoading={myTasks.isLoading}
          value={task}
          onChange={setTask}
        />
      </div>

      <div className="grid gap-2 sm:max-w-32">
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
          className="text-right tabular-nums"
          onChange={(event) => setHours(event.target.value)}
        />
      </div>

      {task !== null && (
        <DayLoadNotice
          date={day.date}
          instanceIndex={task.instanceIndex}
          kind="task"
          id={task.taskId}
          hours={hoursValid ? parsedHours : 0}
          description={description}
        />
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-description`}>
          {t("quickLog.description")}
        </Label>
        <Textarea
          id={`${fieldId}-description`}
          value={description}
          placeholder={t("timesheet.descriptionPlaceholder")}
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

/** Logs the missing hours of a short day on a task picked in a list. */
export function CompleteDayDialog({
  open,
  day,
  entries,
  onOpenChange,
  onLogged,
}: CompleteDayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {day !== null && (
          <CompleteDayForm
            key={day.date}
            day={day}
            entries={entries}
            onLogged={onLogged}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
