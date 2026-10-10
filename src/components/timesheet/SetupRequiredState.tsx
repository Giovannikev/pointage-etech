import { PlugIcon } from "lucide-react"
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

/** Shown until the user has a GitHub token and at least one Odoo instance. */
export function SetupRequiredState({
  onOpenSettings,
}: {
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugIcon />
        </EmptyMedia>
        <EmptyTitle>{t("setup.title")}</EmptyTitle>
        <EmptyDescription>{t("setup.description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onOpenSettings}>{t("common.openSettings")}</Button>
      </EmptyContent>
    </Empty>
  )
}
