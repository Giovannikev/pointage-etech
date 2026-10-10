import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CenteredScreen } from "@/components/CenteredScreen"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { useSession } from "@/hooks/useSession"
import { useTimesheet } from "@/hooks/useTimesheet"
import { DashboardLayout } from "@/layouts/DashboardLayout"
import { SignInPage } from "@/pages/auth/SignInPage"
import { SettingsPage } from "@/pages/settings/SettingsPage"
import { TimesheetPage } from "@/pages/timesheet/TimesheetPage"
import { signOut } from "@/services/authService"
import type { AppView } from "@/types/navigation"

function Workspace({ userEmail }: { userEmail: string }) {
  const { t } = useTranslation()
  const [view, setView] = useState<AppView>("timesheet")
  const timesheet = useTimesheet()

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut()
    } catch (error) {
      toast.error(t("app.logoutError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <DashboardLayout
      activeView={view}
      onNavigate={setView}
      userEmail={userEmail}
      onSignOut={handleSignOut}
    >
      {view === "timesheet" ? (
        <TimesheetPage
          timesheet={timesheet}
          onOpenSettings={() => setView("settings")}
        />
      ) : (
        <SettingsPage />
      )}
    </DashboardLayout>
  )
}

export function App() {
  const { t } = useTranslation()
  const session = useSession()

  switch (session.status) {
    case "loading":
      return (
        <CenteredScreen>
          <Loader2Icon
            className="size-6 animate-spin text-muted-foreground"
            aria-label={t("common.loading")}
          />
        </CenteredScreen>
      )
    case "misconfigured":
      return (
        <CenteredScreen>
          <div className="grid max-w-md gap-2 text-center">
            <h1 className="text-lg font-semibold">{t("app.misconfigured")}</h1>
            <p className="text-sm text-muted-foreground">{session.message}</p>
          </div>
        </CenteredScreen>
      )
    case "signedOut":
      return <SignInPage />
    case "signedIn":
      return (
        // Keyed by user so nothing from a previous account survives a switch.
        <SettingsProvider key={session.user.id}>
          <Workspace userEmail={session.user.email ?? ""} />
        </SettingsProvider>
      )
  }
}
