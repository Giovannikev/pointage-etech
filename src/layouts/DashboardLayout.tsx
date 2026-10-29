import { useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { AppSidebar } from "@/components/dashboard/appSidebar"
import { SiteHeader } from "@/components/dashboard/siteHeader"
import { CheckInWidget } from "@/components/leaves/CheckInWidget"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { AppView } from "@/types/navigation"

const VIEW_TITLE_KEYS = {
  timesheet: "nav.timesheet",
  kanban: "nav.kanban",
  tasks: "nav.tasks",
  history: "nav.history",
  leaves: "nav.leaves",
  settings: "nav.settings",
} as const satisfies Record<AppView, string>

/** Cookie the shadcn sidebar writes on every toggle (components/ui/sidebar.tsx). */
const SIDEBAR_COOKIE = "sidebar_state"

/** Reopens the sidebar as the user left it, expanded or collapsed. */
function readSidebarOpen(): boolean {
  return !document.cookie.split("; ").includes(`${SIDEBAR_COOKIE}=false`)
}

interface DashboardLayoutProps {
  activeView: AppView
  onNavigate: (view: AppView) => void
  userEmail: string
  onSignOut: () => void
  children: ReactNode
}

export function DashboardLayout({
  activeView,
  onNavigate,
  userEmail,
  onSignOut,
  children,
}: DashboardLayoutProps) {
  const { t } = useTranslation()
  const [defaultOpen] = useState(readSidebarOpen)

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        activeView={activeView}
        onNavigate={onNavigate}
        userEmail={userEmail}
        onSignOut={onSignOut}
      />
      {/* min-w-0 lets the page shrink while the sidebar expands, instead of
          overflowing the window during the animation. */}
      <SidebarInset className="min-w-0">
        <SiteHeader title={t(VIEW_TITLE_KEYS[activeView])} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
      <CheckInWidget />
    </SidebarProvider>
  )
}
