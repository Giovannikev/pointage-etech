import type { CSSProperties, ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { AppSidebar } from "@/components/dashboard/appSidebar"
import { SiteHeader } from "@/components/dashboard/siteHeader"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { AppView } from "@/types/navigation"

const VIEW_TITLE_KEYS = {
  timesheet: "nav.timesheet",
  settings: "nav.settings",
} as const satisfies Record<AppView, string>

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

  return (
    <SidebarProvider
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
      <SidebarInset>
        <SiteHeader title={t(VIEW_TITLE_KEYS[activeView])} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
