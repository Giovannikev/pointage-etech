import type { ComponentProps } from "react"
import {
  ClockIcon,
  HistoryIcon,
  KeyRoundIcon,
  ListTodoIcon,
  SettingsIcon,
  UserRoundCheckIcon,
} from "lucide-react"
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
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
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
  const { setOpenMobile } = useSidebar()
  const instances = useOdooInstances()

  // Every way of changing page also closes the sidebar sheet on phones.
  const navigate = (view: AppView): void => {
    onNavigate(view)
    setOpenMobile(false)
  }
  const navMain: NavMainItem[] = [
    { view: "timesheet", title: t("nav.timesheet"), icon: ClockIcon },
    { view: "kanban", title: t("nav.kanban"), icon: UserRoundCheckIcon },
    { view: "tasks", title: t("nav.tasks"), icon: ListTodoIcon },
    { view: "history", title: t("nav.history"), icon: HistoryIcon },
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
    // Collapses to an icon rail on desktop (tooltips name each icon).
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Pointage"
              onClick={() => navigate("timesheet")}
            >
              <BrandMark className="size-8!" />
              <span className="text-base font-semibold">Pointage</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMain}
          activeView={activeView}
          onNavigate={navigate}
        />
        <NavInstances instances={instances} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          email={userEmail}
          onOpenSettings={() => navigate("settings")}
          onSignOut={onSignOut}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
