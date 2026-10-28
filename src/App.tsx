import { lazy, Suspense, useEffect } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CenteredScreen } from "@/components/CenteredScreen"
import { UpdateBanner } from "@/components/UpdateBanner"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { useHashNavigation } from "@/hooks/useHashNavigation"
import { useSession } from "@/hooks/useSession"
import { useTimesheet } from "@/hooks/useTimesheet"
import { useVersionCheck } from "@/hooks/useVersionCheck"
import { DashboardLayout } from "@/layouts/DashboardLayout"
import { ResetPasswordPage } from "@/pages/auth/ResetPasswordPage"
import { SignInPage } from "@/pages/auth/SignInPage"
import { signOut } from "@/services/authService"
import { clearOdooCache } from "@/services/odooService"

/*
 * Each page is its own chunk, loaded the first time it is opened: the first
 * screen doesn't wait for the code of the others. The PWA service worker
 * still caches them all, so the app keeps working offline.
 */
const TimesheetPage = lazy(() =>
  import("@/pages/timesheet/TimesheetPage").then((module) => ({
    default: module.TimesheetPage,
  }))
)
const KanbanPage = lazy(() =>
  import("@/pages/kanban/KanbanPage").then((module) => ({
    default: module.KanbanPage,
  }))
)
const TasksPage = lazy(() =>
  import("@/pages/tasks/TasksPage").then((module) => ({
    default: module.TasksPage,
  }))
)
const HistoryPage = lazy(() =>
  import("@/pages/history/HistoryPage").then((module) => ({
    default: module.HistoryPage,
  }))
)
const LeavesPage = lazy(() =>
  import("@/pages/leaves/LeavesPage").then((module) => ({
    default: module.LeavesPage,
  }))
)
const SettingsPage = lazy(() =>
  import("@/pages/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  }))
)

/** Shown in the page area while a page's code loads. */
function PageLoader() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Loader2Icon
        className="size-6 animate-spin text-muted-foreground"
        aria-label={t("common.loading")}
      />
    </div>
  )
}

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
      case "tasks":
        return <TasksPage onOpenSettings={openSettings} />
      case "history":
        return <HistoryPage onOpenSettings={openSettings} />
      case "leaves":
        return <LeavesPage onOpenSettings={openSettings} />
      case "settings":
        return <SettingsPage userEmail={userEmail} />
    }
  }

  return (
    <DashboardLayout
      activeView={view}
      onNavigate={navigate}
      userEmail={userEmail}
      onSignOut={handleSignOut}
    >
      <Suspense fallback={<PageLoader />}>{renderView()}</Suspense>
    </DashboardLayout>
  )
}

export function App() {
  const session = useSession()
  // Signed in or not: a stale sign-in page needs the reload as much.
  const versionCheck = useVersionCheck()

  return (
    <>
      <SessionScreen session={session} />
      {versionCheck.isUpdateAvailable && (
        <UpdateBanner onDismiss={versionCheck.dismiss} />
      )}
    </>
  )
}

function SessionScreen({
  session,
}: {
  session: ReturnType<typeof useSession>
}) {
  const { t } = useTranslation()

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
    case "recovery":
      return (
        <ResetPasswordPage
          email={session.user.email ?? ""}
          onDone={session.finishRecovery}
        />
      )
    case "signedIn":
      return (
        // Keyed by user so nothing from a previous account survives a switch.
        <SettingsProvider key={session.user.id}>
          <Workspace userEmail={session.user.email ?? ""} />
        </SettingsProvider>
      )
  }
}
