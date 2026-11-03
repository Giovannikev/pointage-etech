import { useEffect, useState } from "react"
import {
  EllipsisIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  RoutineDialog,
  type RoutineTarget,
} from "@/components/history/RoutineDialog"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import {
  deleteRoutine,
  fetchRoutines,
  notifyRoutinesChanged,
  onRoutinesChanged,
  updateRoutine,
  type TimesheetRoutine,
} from "@/services/timesheetRoutineService"

const fetcher = () => fetchRoutines()
const noCache = () => undefined

/**
 * The lines logged automatically every working day. Shown once there is
 * one: they are made from a line's menu in the history.
 */
export function TimesheetRoutinesCard() {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const { data, refresh } = useCachedQuery("routines", fetcher, noCache)
  const editDialog = useDialogTarget<RoutineTarget>()
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => onRoutinesChanged(refresh), [refresh])

  const run = async (
    routine: TimesheetRoutine,
    action: () => Promise<void>,
    done: string
  ): Promise<void> => {
    setBusyId(routine.id)
    try {
      await action()
      notifyRoutinesChanged()
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  if (data === undefined || data.length === 0) {
    return null
  }

  return (
    <section className="grid gap-3" aria-labelledby="routines-heading">
      <div className="grid gap-0.5">
        <h3
          id="routines-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <RepeatIcon className="size-4 text-muted-foreground" />
          {t("routines.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("routines.hint")}</p>
      </div>
      <ul className="grid divide-y rounded-xl border">
        {data.map((routine) => (
          <li
            key={routine.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 text-sm",
              !routine.enabled && "text-muted-foreground"
            )}
          >
            <InstanceBadge instanceIndex={routine.instanceIndex} />
            <div className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
              <div className="grid min-w-0">
                {routine.projectName !== null && (
                  <span className="truncate text-xs text-muted-foreground">
                    {routine.projectName}
                  </span>
                )}
                <span className="truncate font-medium">{routine.taskName}</span>
              </div>
              <span className="truncate text-muted-foreground sm:text-foreground">
                {routine.description}
              </span>
            </div>
            <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
              <span className="tabular-nums">{formatHours(routine.hours)}</span>
              {routine.enabled ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("routines.at", { time: routine.logAt })}
                </span>
              ) : (
                <Badge variant="outline">{t("routines.paused")}</Badge>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  disabled={busyId === routine.id}
                  aria-label={t("history.actionsFor", {
                    line: routine.taskName,
                  })}
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={() => editDialog.open(routine)}>
                  <PencilIcon />
                  {t("history.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void run(
                      routine,
                      () =>
                        updateRoutine(routine.id, {
                          enabled: !routine.enabled,
                        }),
                      routine.enabled
                        ? t("routines.pausedToast")
                        : t("routines.resumedToast")
                    )
                  }
                >
                  {routine.enabled ? <PauseIcon /> : <PlayIcon />}
                  {routine.enabled ? t("routines.pause") : t("routines.resume")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    void run(
                      routine,
                      () => deleteRoutine(routine.id),
                      t("routines.deleted")
                    )
                  }
                >
                  <Trash2Icon />
                  {t("history.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <RoutineDialog
        open={editDialog.isOpen}
        target={editDialog.target}
        onOpenChange={(open) => !open && editDialog.close()}
        onSaved={() => {
          editDialog.close()
          toast.success(t("routines.saved"))
        }}
      />
    </section>
  )
}
