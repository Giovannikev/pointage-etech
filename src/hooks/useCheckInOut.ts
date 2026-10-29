import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useOdooInstances } from "@/contexts/SettingsContext"
import { checkInOut } from "@/services/odooService"
import type { OdooInstanceIndex } from "@/types/timesheet"

/** Checks in or out on one instance, with the notifications of the result. */
export function useCheckInOut(instanceIndex: OdooInstanceIndex) {
  const { t } = useTranslation()
  const instances = useOdooInstances()
  const [isSaving, setIsSaving] = useState(false)
  const odooUrl = instances.find(
    (instance) => instance.index === instanceIndex
  )?.url

  const toggle = async (): Promise<void> => {
    setIsSaving(true)
    try {
      const openSince = await checkInOut(instanceIndex)
      toast.success(
        openSince === null ? t("leaves.checkedOut") : t("leaves.checkedIn")
      )
    } catch (error) {
      // Odoo's own button still works when the gateway can't sign in.
      toast.error(t("leaves.checkInError"), {
        description: error instanceof Error ? error.message : String(error),
        action:
          odooUrl === undefined
            ? undefined
            : {
                label: t("leaves.openOdoo"),
                onClick: () => window.open(`${odooUrl}/odoo`, "_blank"),
              },
      })
    } finally {
      setIsSaving(false)
    }
  }

  return { isSaving, toggle }
}
