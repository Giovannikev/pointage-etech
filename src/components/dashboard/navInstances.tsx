import { ExternalLinkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { OdooInstanceSettings } from "@/types/settings"

/** Shortcuts to the user's Odoo instances, colored like their timesheet lines. */
export function NavInstances({
  instances,
}: {
  instances: OdooInstanceSettings[]
}) {
  const { t } = useTranslation()
  if (instances.length === 0) {
    return null
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t("nav.odooInstances")}</SidebarGroupLabel>
      <SidebarMenu>
        {instances.map((instance) => (
          <SidebarMenuItem key={instance.index}>
            <SidebarMenuButton asChild>
              <a href={instance.url} target="_blank" rel="noopener noreferrer">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    INSTANCE_BACKGROUNDS[instance.index]
                  )}
                />
                <span>{instance.label}</span>
                <ExternalLinkIcon className="ml-auto text-muted-foreground" />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
