import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { AppView } from "@/types/navigation"

export interface NavMainItem {
  view: AppView
  title: string
  icon: LucideIcon
}

interface NavMainProps {
  items: NavMainItem[]
  activeView: AppView
  onNavigate: (view: AppView) => void
}

export function NavMain({ items, activeView, onNavigate }: NavMainProps) {
  const { setOpenMobile } = useSidebar()

  const navigate = (view: AppView): void => {
    onNavigate(view)
    setOpenMobile(false)
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.view}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.view === activeView}
                onClick={() => navigate(item.view)}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
