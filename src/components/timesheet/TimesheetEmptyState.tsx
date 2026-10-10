import { useTranslation } from "react-i18next"

/** Shown before any commit is imported. */
export function TimesheetEmptyState() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-start gap-6 rounded-xl border border-dashed px-6 py-12 sm:items-center sm:text-center">
      <div className="grid max-w-md gap-2">
        <h2 className="text-lg font-semibold">{t("timesheet.emptyTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("timesheet.emptyDescription")}
        </p>
      </div>
      <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
        <span className="text-instance-1">[03-500]</span> matelec_sale: add
        french translations
      </code>
    </div>
  )
}
