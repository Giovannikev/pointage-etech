import { useEffect, useId, useState } from "react"
import { BellRingIcon, Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { toLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  DEFAULT_REMIND_HOUR,
  detectTimezone,
  fetchReminderPreferences,
  saveReminderPreferences,
  type ReminderPreferences,
} from "@/services/reminderService"

/** Hours offered for the reminder: from midday to late evening. */
const REMIND_HOURS = Array.from({ length: 12 }, (_, offset) => 12 + offset)

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" }

/** On working days, an email when less than a full day is logged in Odoo. */
export function ReminderSettingsCard() {
  const { t, i18n } = useTranslation()
  const fieldId = useId()
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [draft, setDraft] = useState<ReminderPreferences>(() => ({
    enabled: false,
    remindHour: DEFAULT_REMIND_HOUR,
    timezone: detectTimezone(),
    language: toLanguage(i18n.resolvedLanguage),
  }))
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isCurrent = true
    fetchReminderPreferences().then(
      (saved) => {
        if (!isCurrent) return
        if (saved !== null) {
          setDraft(saved)
        }
        setLoad({ status: "ready" })
      },
      (error: unknown) => {
        if (isCurrent) {
          setLoad({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    )
    return () => {
      isCurrent = false
    }
  }, [])

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    // Follow the device the user saves from: time zone and interface language.
    const preferences: ReminderPreferences = {
      ...draft,
      timezone: detectTimezone(),
      language: toLanguage(i18n.resolvedLanguage),
    }
    try {
      await saveReminderPreferences(preferences)
      setDraft(preferences)
      toast.success(
        preferences.enabled ? t("reminder.savedOn") : t("reminder.savedOff")
      )
    } catch (error) {
      toast.error(t("reminder.saveError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRingIcon className="size-4" />
          {t("reminder.title")}
        </CardTitle>
        <CardDescription>{t("reminder.description")}</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {load.status === "loading" && <Skeleton className="h-16 w-full" />}
        {load.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {t("reminder.loadError", { message: load.message })}
          </p>
        )}
        {load.status === "ready" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`${fieldId}-enabled`}>
                {t("reminder.enabled")}
              </Label>
              {/* A switch: the native checkbox semantics, drawn as a toggle. */}
              <button
                id={`${fieldId}-enabled`}
                type="button"
                role="switch"
                aria-checked={draft.enabled}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                  draft.enabled ? "bg-primary" : "bg-input"
                )}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "block size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
                    draft.enabled ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            <div className="grid gap-2 sm:max-w-48">
              <Label htmlFor={`${fieldId}-hour`}>{t("reminder.hour")}</Label>
              <select
                id={`${fieldId}-hour`}
                value={draft.remindHour}
                disabled={!draft.enabled}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    remindHour: Number(event.target.value),
                  }))
                }
              >
                {REMIND_HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {t("reminder.hourOption", {
                      hour: String(hour).padStart(2, "0"),
                    })}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("reminder.timezone", { timezone: detectTimezone() })}
              </p>
            </div>
          </>
        )}
      </CardContent>

      {load.status === "ready" && (
        <CardFooter className="justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            {t("reminder.save")}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
