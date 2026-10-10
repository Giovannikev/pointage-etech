import { useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { GithubSettingsCard } from "@/components/settings/GithubSettingsCard"
import { OdooInstanceCard } from "@/components/settings/OdooInstanceCard"
import { Button } from "@/components/ui/button"
import { useSettings } from "@/contexts/SettingsContext"
import type { SettingsView } from "@/types/settings"
import type { OdooInstanceIndex } from "@/types/timesheet"
import { ODOO_INSTANCE_INDEXES } from "@/utils/settings"
import {
  toSettingsDraft,
  toSettingsUpdate,
  type OdooInstanceDraft,
  type SettingsDraft,
} from "@/utils/settingsForm"

export function SettingsForm({ settings }: { settings: SettingsView }) {
  const { t } = useTranslation()
  const { save } = useSettings()
  const [draft, setDraft] = useState(() => toSettingsDraft(settings))
  const [isSaving, setIsSaving] = useState(false)

  const updateDraft = (patch: Partial<SettingsDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }))

  const updateInstance = (
    index: OdooInstanceIndex,
    patch: Partial<OdooInstanceDraft>
  ): void =>
    setDraft((current) => ({
      ...current,
      instances: {
        ...current.instances,
        [index]: { ...current.instances[index], ...patch },
      },
    }))

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    setIsSaving(true)
    try {
      // Secrets are cleared from the form once stored: they're write-only.
      setDraft(toSettingsDraft(await save(toSettingsUpdate(draft))))
      toast.success(t("settings.saved"), {
        description: t("settings.savedDescription"),
      })
    } catch (error) {
      toast.error(t("settings.saveError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <GithubSettingsCard
        draft={draft}
        stored={settings.github}
        onChange={updateDraft}
      />
      {ODOO_INSTANCE_INDEXES.map((index) => (
        <OdooInstanceCard
          key={index}
          index={index}
          draft={draft.instances[index]}
          onChange={(patch) => updateInstance(index, patch)}
        />
      ))}
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving && <Loader2Icon className="animate-spin" />}
          {t("settings.save")}
        </Button>
      </div>
    </form>
  )
}
