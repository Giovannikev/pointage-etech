import { useCallback, useId, useState, type FormEvent } from "react"
import {
  CheckIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { AutoAttendanceState } from "@/hooks/useAutoAttendance"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useFormatters } from "@/hooks/useFormatters"
import { useNow } from "@/hooks/useNow"
import { cn } from "@/lib/utils"
import {
  defaultAutoAttendance,
  fetchAutoAttendancePlan,
  MAX_RANDOM_WINDOW,
  scheduleProblem,
  type AutoAttendancePlan,
  type AutoAttendancePreferences,
} from "@/services/autoAttendanceService"

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function ScheduleForm({
  initial,
  onSave,
  onDone,
}: {
  initial: AutoAttendancePreferences
  onSave: (preferences: AutoAttendancePreferences) => Promise<void>
  /** Closes the form; absent when it is the only content. */
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const [draft, setDraft] = useState(initial)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = scheduleProblem(draft)
  const set = (patch: Partial<AutoAttendancePreferences>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (problem !== null) return
    setIsSaving(true)
    setError(null)
    try {
      await onSave(draft)
      toast.success(t("leaves.auto.saved"))
      onDone?.()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError)
      )
    } finally {
      setIsSaving(false)
    }
  }

  const windowMinutes = draft.randomWindowMinutes
  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <Label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={draft.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
        {t("leaves.auto.toggle")}
      </Label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          {t("leaves.auto.morning")}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <TimeField
            label={t("leaves.auto.start")}
            value={draft.morningStart}
            onChange={(value) => set({ morningStart: value })}
          />
          <TimeField
            label={t("leaves.auto.end")}
            value={draft.morningEnd}
            onChange={(value) => set({ morningEnd: value })}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          {t("leaves.auto.afternoon")}
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <TimeField
            label={t("leaves.auto.start")}
            value={draft.afternoonStart}
            onChange={(value) => set({ afternoonStart: value })}
          />
          <TimeField
            label={t("leaves.auto.officeEnd")}
            value={draft.afternoonEnd}
            onChange={(value) => set({ afternoonEnd: value })}
          />
          <div className="grid gap-1.5">
            <TimeField
              label={t("leaves.auto.remoteEnd")}
              value={draft.remoteAfternoonEnd ?? draft.afternoonEnd}
              onChange={(value) => set({ remoteAfternoonEnd: value })}
            />
            <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={draft.remoteAfternoonEnd === null}
                onChange={(event) =>
                  set({
                    remoteAfternoonEnd: event.target.checked
                      ? null
                      : draft.afternoonEnd,
                  })
                }
              />
              {t("leaves.auto.remoteSame")}
            </Label>
          </div>
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${fieldId}-window`}>{t("leaves.auto.window")}</Label>
        <Input
          id={`${fieldId}-window`}
          type="number"
          min={0}
          max={MAX_RANDOM_WINDOW}
          step={1}
          className="w-28"
          value={Number.isNaN(windowMinutes) ? "" : windowMinutes}
          onChange={(event) =>
            set({ randomWindowMinutes: event.target.valueAsNumber })
          }
        />
        {Number.isInteger(windowMinutes) &&
          windowMinutes > 0 &&
          windowMinutes < 60 && (
            <p className="text-xs text-muted-foreground">
              {t("leaves.auto.windowHint", {
                minutes: windowMinutes,
                end: String(windowMinutes).padStart(2, "0"),
              })}
            </p>
          )}
      </div>

      {problem !== null && (
        <p className="text-sm text-destructive" role="alert">
          {t(`leaves.auto.problem.${problem}`, { max: MAX_RANDOM_WINDOW })}
        </p>
      )}
      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          className="max-sm:w-full"
          disabled={isSaving || problem !== null}
        >
          {isSaving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          {t("leaves.auto.save")}
        </Button>
        {onDone !== undefined && (
          <Button
            type="button"
            variant="outline"
            className="max-sm:w-full"
            disabled={isSaving}
            onClick={onDone}
          >
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  )
}

function TodayPlan({
  plan,
  enabled,
}: {
  plan: AutoAttendancePlan
  enabled: boolean
}) {
  const { t } = useTranslation()
  const { formatTime } = useFormatters()
  const now = useNow()
  // Local "HH:MM" of now, in the schedule's day: punches before it are done.
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  const next = plan.punches.find((punch) => punch.time > clock)

  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        {plan.remote ? t("leaves.auto.todayRemote") : t("leaves.auto.today")}
      </h3>
      {!enabled && (
        <p className="text-xs text-muted-foreground">
          {t("leaves.auto.offHint")}
        </p>
      )}
      {!plan.workingDay ? (
        <p className="text-sm text-muted-foreground">
          {t("leaves.auto.weekend")}
        </p>
      ) : plan.punches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("leaves.auto.noPunch")}
        </p>
      ) : (
        <ol className="flex flex-wrap gap-2">
          {plan.punches.map((punch) => (
            <li
              key={`${punch.time}-${punch.action}`}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm tabular-nums",
                punch.time <= clock && "bg-muted/50 text-muted-foreground",
                punch === next && "border-primary bg-primary/10 font-medium"
              )}
            >
              {punch.time <= clock ? (
                <CheckIcon className="size-3.5 text-success" />
              ) : punch.action === "in" ? (
                <LogInIcon className="size-3.5" />
              ) : (
                <LogOutIcon className="size-3.5" />
              )}
              {punch.time} · {t(`leaves.auto.${punch.action}`)}
            </li>
          ))}
        </ol>
      )}
      {enabled && plan.nextPunchAt !== null && (
        <p className="text-xs text-muted-foreground">
          {t("leaves.auto.next", {
            time: formatTime(plan.nextPunchAt) ?? plan.nextPunchAt,
          })}
        </p>
      )}
    </section>
  )
}

/** The saved hours in one glance, with a switch and a way to edit them. */
function ScheduleSummary({
  preferences,
  onSave,
  onEdit,
}: {
  preferences: AutoAttendancePreferences
  onSave: (preferences: AutoAttendancePreferences) => Promise<void>
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)
  const toggle = async () => {
    setIsSaving(true)
    try {
      await onSave({ ...preferences, enabled: !preferences.enabled })
      toast.success(t("leaves.auto.saved"))
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setIsSaving(false)
    }
  }
  const { remoteAfternoonEnd, afternoonEnd } = preferences
  return (
    <section className="grid gap-3 rounded-lg border p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">{t("leaves.auto.morning")}</dt>
        <dd>
          {preferences.morningStart} – {preferences.morningEnd}
        </dd>
        <dt className="text-muted-foreground">{t("leaves.auto.afternoon")}</dt>
        <dd>
          {preferences.afternoonStart} – {afternoonEnd}
          {remoteAfternoonEnd !== null &&
            remoteAfternoonEnd !== afternoonEnd && (
              <span className="text-muted-foreground">
                {" "}
                · {t("leaves.auto.remoteShort", { time: remoteAfternoonEnd })}
              </span>
            )}
        </dd>
        <dt className="text-muted-foreground">
          {t("leaves.auto.windowShort")}
        </dt>
        <dd>
          {t("leaves.auto.windowValue", {
            minutes: preferences.randomWindowMinutes,
          })}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={preferences.enabled ? "outline" : "default"}
          disabled={isSaving}
          onClick={() => void toggle()}
        >
          {isSaving && <Loader2Icon className="animate-spin" />}
          {preferences.enabled
            ? t("leaves.auto.turnOff")
            : t("leaves.auto.turnOn")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <PencilIcon />
          {t("leaves.auto.editHours")}
        </Button>
      </div>
    </section>
  )
}

/** Automatic check-in and check-out: settings and today's plan. */
export function AutoAttendanceCard({ state }: { state: AutoAttendanceState }) {
  const { t } = useTranslation()
  const { preferences, error, save } = state
  const hasSettings = preferences !== undefined && preferences !== null
  // Read once the settings are known; the key below reads it again after
  // each save.
  const planFetcher = useCallback(
    (): Promise<AutoAttendancePlan | null> =>
      hasSettings ? fetchAutoAttendancePlan() : Promise.resolve(null),
    [hasSettings]
  )
  const noCache = useCallback(() => undefined, [])
  const {
    data: plan,
    error: planError,
    isLoading: isLoadingPlan,
    isRefreshing,
    refresh: loadPlan,
  } = useCachedQuery(
    `autoAttendancePlan:${JSON.stringify(preferences ?? null)}`,
    planFetcher,
    noCache
  )

  const enabled = preferences?.enabled === true
  const [isEditing, setIsEditing] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("leaves.auto.title")}
          {preferences !== undefined && (
            <Badge
              className={cn(
                "font-semibold",
                enabled
                  ? "bg-success/12 text-success"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {enabled ? t("leaves.auto.enabled") : t("leaves.auto.disabled")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("leaves.auto.subtitle")}</CardDescription>
        {preferences !== null && preferences !== undefined && (
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("leaves.refresh")}
              disabled={isLoadingPlan || isRefreshing}
              onClick={loadPlan}
            >
              <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-6">
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {preferences === undefined ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : (
          <>
            {plan !== undefined && plan !== null && (
              <TodayPlan plan={plan} enabled={enabled} />
            )}
            {hasSettings && isLoadingPlan && (
              <Skeleton className="h-10 w-full rounded-lg" />
            )}
            {planError !== null && (
              <p className="text-sm text-muted-foreground" role="status">
                {t("leaves.auto.planUnavailable", { error: planError })}
              </p>
            )}
            {preferences === null ? (
              <ScheduleForm initial={defaultAutoAttendance()} onSave={save} />
            ) : isEditing ? (
              <ScheduleForm
                initial={preferences}
                onSave={save}
                onDone={() => setIsEditing(false)}
              />
            ) : (
              <ScheduleSummary
                preferences={preferences}
                onSave={save}
                onEdit={() => setIsEditing(true)}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
