import type { ComponentProps } from "react"
import { ClockIcon, KeyRoundIcon, SettingsIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/BrandMark"
import { NavInstances } from "@/components/dashboard/navInstances"
import { NavMain, type NavMainItem } from "@/components/dashboard/navMain"
import {
  NavSecondary,
  type NavSecondaryItem,
} from "@/components/dashboard/navSecondary"
import { NavUser } from "@/components/dashboard/navUser"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useOdooInstances } from "@/contexts/SettingsContext"
import type { AppView } from "@/types/navigation"

const GITHUB_TOKEN_URL =
  "https://github.com/settings/tokens/new?description=Pointage&scopes=repo"

interface AppSidebarProps extends ComponentProps<typeof Sidebar> {
  activeView: AppView
  onNavigate: (view: AppView) => void
  userEmail: string
  onSignOut: () => void
}

export function AppSidebar({
  activeView,
  onNavigate,
  userEmail,
  onSignOut,
  ...props
}: AppSidebarProps) {
  const { t } = useTranslation()
  const instances = useOdooInstances()
  const navMain: NavMainItem[] = [
    { view: "timesheet", title: t("nav.timesheet"), icon: ClockIcon },
    { view: "settings", title: t("nav.settings"), icon: SettingsIcon },
  ]
  const navSecondary: NavSecondaryItem[] = [
    {
      title: t("nav.createGithubToken"),
      url: GITHUB_TOKEN_URL,
      icon: KeyRoundIcon,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2 p-1.5">
            <BrandMark />
            <span className="text-base font-semibold">Pointage</span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMain}
          activeView={activeView}
          onNavigate={onNavigate}
        />
        <NavInstances instances={instances} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          email={userEmail}
          onOpenSettings={() => onNavigate("settings")}
          onSignOut={onSignOut}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
