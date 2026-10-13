import { TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useInstanceLabel } from "@/contexts/SettingsContext"
import type { OdooInstanceIndex } from "@/types/timesheet"

/** One instance couldn't be read; the other instance's data is still shown. */
export function InstanceErrorNotice({
  instanceIndex,
  message,
}: {
  instanceIndex: OdooInstanceIndex
  message: string
}) {
  const { t } = useTranslation()
  const label = useInstanceLabel(instanceIndex)
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>
        <span className="font-medium">
          {t("instanceFilter.readError", { instance: label })}
        </span>{" "}
        <span className="text-muted-foreground">{message}</span>
      </span>
    </p>
  )
}
