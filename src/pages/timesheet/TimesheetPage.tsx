import { useState } from "react"
import {
  ClipboardPasteIcon,
  GitCommitHorizontalIcon,
  Loader2Icon,
} from "lucide-react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { SettingsGate } from "@/components/settings/SettingsGate"
import { CommitImportModal } from "@/components/timesheet/CommitImportModal"
import { CommitPeriodPicker } from "@/components/timesheet/CommitPeriodPicker"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"
import { TimesheetActionBar } from "@/components/timesheet/TimesheetActionBar"
import { TimesheetEmptyState } from "@/components/timesheet/TimesheetEmptyState"
import { TimesheetTable } from "@/components/timesheet/TimesheetTable"
import { Button } from "@/components/ui/button"
import { useFormatters } from "@/hooks/useFormatters"
import type { UseTimesheetResult } from "@/hooks/useTimesheet"
import type {
  ImportSummary,
  SubmissionSummary,
  VerificationSummary,
} from "@/types/timesheet"
import { isValidPeriod } from "@/utils/period"
import { isSetupComplete } from "@/utils/settings"

function describeVerification(
  summary: VerificationSummary,
  t: TFunction
): string {
  const parts = [t("notifications.foundInOdoo", { count: summary.found })]
  if (summary.alreadyLogged > 0) {
    parts.push(
      t("notifications.alreadyLogged", { count: summary.alreadyLogged })
    )
  }
  if (summary.missing > 0) {
    parts.push(t("notifications.missing", { count: summary.missing }))
  }
  return `${parts.join(", ")}.`
}

function notifyVerification(summary: VerificationSummary, t: TFunction): void {
  if (summary.errorMessage !== null) {
    toast.error(t("notifications.checkError"), {
      description: summary.errorMessage,
    })
  } else if (summary.missing > 0 && summary.found === 0) {
    toast.warning(t("notifications.taskNotFound"), {
      description: t("notifications.taskNotFoundHint"),
    })
  } else if (summary.found > 0) {
    toast.success(t("notifications.taskFound"), {
      description: describeVerification(summary, t),
    })
  }
}

function notifyImport(summary: ImportSummary, t: TFunction): void {
  if (summary.added === 0) {
    toast.info(
      t(
        summary.duplicates > 0
          ? "notifications.alreadyImported"
          : "notifications.nothingToImport"
      ),
      {
        description:
          summary.duplicates > 0
            ? t("notifications.alreadyInList", { count: summary.duplicates })
            : t("notifications.skippedHint"),
      }
    )
    return
  }

  if (summary.verification.errorMessage !== null) {
    notifyVerification(summary.verification, t)
    return
  }

  const skipped =
    summary.duplicates > 0
      ? ` ${t("notifications.duplicatesSkipped", { count: summary.duplicates })}`
      : ""
  toast.success(t("notifications.imported", { count: summary.added }), {
    description: `${describeVerification(summary.verification, t)}${skipped}`,
  })
}

function notifySubmission(summary: SubmissionSummary, t: TFunction): void {
  if (summary.submitted > 0 && summary.failed === 0) {
    toast.success(t("notifications.submitted", { count: summary.submitted }))
  } else if (summary.submitted > 0) {
    toast.warning(
      t("notifications.partlySubmitted", {
        submitted: summary.submitted,
        failed: summary.failed,
      }),
      { description: summary.errorMessage ?? undefined }
    )
  } else if (summary.failed > 0) {
    toast.error(t("notifications.submitError", { count: summary.failed }), {
      description: summary.errorMessage ?? undefined,
    })
  }
}

interface TimesheetPageProps {
  /** Owned by the app shell, so the lines survive a visit to the settings. */
  timesheet: UseTimesheetResult
  onOpenSettings: () => void
}

export function TimesheetPage({
  timesheet,
  onOpenSettings,
}: TimesheetPageProps) {
  const { t } = useTranslation()
  const { formatPeriod } = useFormatters()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const hasEntries = timesheet.entries.length > 0

  const openImportModal = (): void => setIsImportModalOpen(true)

  const handleFetchCommits = async (): Promise<void> => {
    try {
      notifyImport(await timesheet.importFromGithub(), t)
    } catch (error) {
      toast.error(t("notifications.fetchError"), {
        description: error instanceof Error ? error.message : undefined,
        action: {
          label: t("notifications.pasteInstead"),
          onClick: openImportModal,
        },
      })
    }
  }

  const handlePasteImport = async (
    raw: string,
    date: string
  ): Promise<void> => {
    const summary = await timesheet.importFromText(raw, date)
    setIsImportModalOpen(false)
    notifyImport(summary, t)
  }

  const handleVerify = async (id: string): Promise<void> => {
    notifyVerification(await timesheet.verifyEntry(id), t)
  }

  const handleSubmit = async (id: string): Promise<void> => {
    notifySubmission(await timesheet.submitEntry(id), t)
  }

  const handleSubmitAll = async (): Promise<void> => {
    notifySubmission(await timesheet.submitAll(), t)
  }

  const workspace = (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {formatPeriod(timesheet.period)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("timesheet.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CommitPeriodPicker
            value={timesheet.period}
            onChange={timesheet.setPeriod}
            disabled={timesheet.isImporting}
          />
          <div className="flex flex-wrap gap-2 max-sm:w-full *:max-sm:flex-1">
            <Button variant="outline" onClick={openImportModal}>
              <ClipboardPasteIcon />
              {t("timesheet.pasteCommits")}
            </Button>
            <Button
              onClick={handleFetchCommits}
              disabled={
                timesheet.isImporting || !isValidPeriod(timesheet.period)
              }
            >
              {timesheet.isImporting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <GitCommitHorizontalIcon />
              )}
              {t("timesheet.fetchCommits")}
            </Button>
          </div>
        </div>
      </div>

      {hasEntries ? (
        <TimesheetTable
          entries={timesheet.entries}
          onDescriptionChange={timesheet.updateDescription}
          onHoursChange={timesheet.updateHours}
          onVerify={handleVerify}
          onSubmit={handleSubmit}
          onRemove={timesheet.removeEntry}
        />
      ) : (
        <TimesheetEmptyState />
      )}
    </>
  )

  return (
    <>
      <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SettingsGate>
          {(settings) =>
            isSetupComplete(settings) ? (
              workspace
            ) : (
              <SetupRequiredState onOpenSettings={onOpenSettings} />
            )
          }
        </SettingsGate>
      </main>

      {hasEntries && (
        <TimesheetActionBar
          entries={timesheet.entries}
          totalHours={timesheet.totalHours}
          submittableCount={timesheet.submittableCount}
          isSubmitting={timesheet.isSubmitting}
          onSubmitAll={handleSubmitAll}
        />
      )}

      <CommitImportModal
        open={isImportModalOpen}
        onOpenChange={setIsImportModalOpen}
        onImport={handlePasteImport}
      />
    </>
  )
}
