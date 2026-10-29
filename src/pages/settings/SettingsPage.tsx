import { useTranslation } from "react-i18next"

import { LanguageSettingsCard } from "@/components/settings/LanguageSettingsCard"
import { PasswordSettingsCard } from "@/components/settings/PasswordSettingsCard"
import { SettingsForm } from "@/components/settings/SettingsForm"
import { SettingsGate } from "@/components/settings/SettingsGate"

interface SettingsPageProps {
  /** The signed-in user's email, for the password card. */
  userEmail: string
}

export function SettingsPage({ userEmail }: SettingsPageProps) {
  const { t } = useTranslation()

  return (
    <main className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t("settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>
      <SettingsGate>
        {(settings) => <SettingsForm settings={settings} />}
      </SettingsGate>
      {/* Outside the gate: the password doesn't depend on the Odoo settings. */}
      <section className="grid gap-4" aria-labelledby="account-heading">
        <h3
          id="account-heading"
          className="mt-4 text-lg font-semibold tracking-tight"
        >
          {t("settings.account")}
        </h3>
        <PasswordSettingsCard email={userEmail} />
        <LanguageSettingsCard />
      </section>
    </main>
  )
}
