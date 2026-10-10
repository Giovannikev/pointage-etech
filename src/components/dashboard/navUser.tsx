import { EllipsisVerticalIcon, LogOutIcon, SettingsIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

interface NavUserProps {
  email: string
  onOpenSettings: () => void
  onSignOut: () => void
}

/** "giovanni.kevin@company.com" -> "GI" */
function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

function UserIdentity({ email }: { email: string }) {
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg">
          {initialsOf(email)}
        </AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate text-left text-sm font-medium">
        {email}
      </span>
    </>
  )
}

export function NavUser({ email, onOpenSettings, onSignOut }: NavUserProps) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserIdentity email={email} />
              <EllipsisVerticalIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="flex items-center gap-2 p-1.5 font-normal">
              <UserIdentity email={email} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <SettingsIcon />
              {t("nav.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOutIcon />
              {t("nav.logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
