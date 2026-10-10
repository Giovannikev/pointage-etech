import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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

/** The current page stands out: inverted colors, like the logo. */
const ACTIVE_ITEM =
  "data-active:bg-sidebar-foreground/15 data-active:text-sidebar-foreground data-active:font-semibold"

export function NavMain({ items, activeView, onNavigate }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.view}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.view === activeView}
                className={ACTIVE_ITEM}
                onClick={() => onNavigate(item.view)}
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
