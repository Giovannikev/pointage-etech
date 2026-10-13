import { useTranslation } from "react-i18next"

import { SettingsForm } from "@/components/settings/SettingsForm"
import { ReminderSettingsCard } from "@/components/settings/ReminderSettingsCard"
import { SettingsGate } from "@/components/settings/SettingsGate"

export function SettingsPage() {
  const { t } = useTranslation()

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t("settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>
      <SettingsGate>
        {(settings) => (
          <>
            <SettingsForm settings={settings} />
            {settings.odooInstances.length > 0 && <ReminderSettingsCard />}
          </>
        )}
      </SettingsGate>
    </main>
  )
}
