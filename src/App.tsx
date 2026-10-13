import { useEffect } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CenteredScreen } from "@/components/CenteredScreen"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { useHashNavigation } from "@/hooks/useHashNavigation"
import { useSession } from "@/hooks/useSession"
import { useTimesheet } from "@/hooks/useTimesheet"
import { DashboardLayout } from "@/layouts/DashboardLayout"
import { SignInPage } from "@/pages/auth/SignInPage"
import { HistoryPage } from "@/pages/history/HistoryPage"
import { KanbanPage } from "@/pages/kanban/KanbanPage"
import { SettingsPage } from "@/pages/settings/SettingsPage"
import { TimesheetPage } from "@/pages/timesheet/TimesheetPage"
import { signOut } from "@/services/authService"
import { clearOdooCache } from "@/services/odooService"

function Workspace({ userEmail }: { userEmail: string }) {
  const { t } = useTranslation()
  const { view, navigate } = useHashNavigation()
  const timesheet = useTimesheet()
  const openSettings = (): void => navigate("settings")

  // Cached Odoo reads belong to this account: drop them when it leaves.
  useEffect(() => clearOdooCache, [])

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut()
    } catch (error) {
      toast.error(t("app.logoutError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const renderView = () => {
    switch (view) {
      case "timesheet":
        return (
          <TimesheetPage timesheet={timesheet} onOpenSettings={openSettings} />
        )
      case "kanban":
        return <KanbanPage onOpenSettings={openSettings} />
      case "history":
        return <HistoryPage onOpenSettings={openSettings} />
      case "settings":
        return <SettingsPage />
    }
  }

  return (
    <DashboardLayout
      activeView={view}
      onNavigate={navigate}
      userEmail={userEmail}
      onSignOut={handleSignOut}
    >
      {renderView()}
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
