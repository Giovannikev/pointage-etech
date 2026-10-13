import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { toViewHash } from "@/hooks/useHashNavigation"
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
  "data-active:bg-sidebar-foreground/5 data-active:text-sidebar-foreground data-active:font-semibold"

export function NavMain({ items, activeView, onNavigate }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.view}>
              {/* Real links to the view's hash: middle-click and "copy link" work. */}
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={item.view === activeView}
                className={ACTIVE_ITEM}
              >
                <a
                  href={toViewHash(item.view)}
                  aria-current={item.view === activeView ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return
                    }
                    event.preventDefault()
                    onNavigate(item.view)
                  }}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
