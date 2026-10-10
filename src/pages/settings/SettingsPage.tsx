import { useTranslation } from "react-i18next"

import { SettingsForm } from "@/components/settings/SettingsForm"
import { SettingsGate } from "@/components/settings/SettingsGate"

export function SettingsPage() {
  const { t } = useTranslation()

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>
      <SettingsGate>
        {(settings) => <SettingsForm settings={settings} />}
      </SettingsGate>
    </main>
  )
}
