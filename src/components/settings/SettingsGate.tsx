import type { ReactNode } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/contexts/SettingsContext"
import type { SettingsView } from "@/types/settings"

interface SettingsGateProps {
  children: (settings: SettingsView) => ReactNode
}

/** Renders its children once the settings are loaded, with loading and error states. */
export function SettingsGate({ children }: SettingsGateProps) {
  const { t } = useTranslation()
  const { state, reload } = useSettings()

  if (state.status === "loading") {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }

  if (state.status === "error") {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("settings.loadError")}</EmptyTitle>
          <EmptyDescription>{state.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={reload}>
            {t("common.tryAgain")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return children(state.settings)
}
