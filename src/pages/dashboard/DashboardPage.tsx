import { useState } from "react"
import {
  ClipboardPasteIcon,
  GitCommitHorizontalIcon,
  Loader2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ThemeToggle } from "@/components/ThemeToggle"
import { CommitImportModal } from "@/components/timesheet/CommitImportModal"
import { TimesheetActionBar } from "@/components/timesheet/TimesheetActionBar"
import { TimesheetEmptyState } from "@/components/timesheet/TimesheetEmptyState"
import { TimesheetTable } from "@/components/timesheet/TimesheetTable"
import { Button } from "@/components/ui/button"
import { useTimesheet } from "@/hooks/useTimesheet"
import type {
  ImportSummary,
  SubmissionSummary,
  VerificationSummary,
} from "@/types/timesheet"
import { formatLongDate, todayIsoDate } from "@/utils/date"
import { pluralize } from "@/utils/format"

function describeVerification(summary: VerificationSummary): string {
  const parts = [`${summary.found} found in Odoo`]
  if (summary.missing > 0) {
    parts.push(`${summary.missing} missing`)
  }
  return `${parts.join(", ")}.`
}

function notifyVerification(summary: VerificationSummary): void {
  if (summary.errorMessage !== null) {
    toast.error("Couldn't check tasks in Odoo", {
      description: summary.errorMessage,
    })
  } else if (summary.missing > 0 && summary.found === 0) {
    toast.warning("Task not found", {
      description: "Check the reference, or that you have access to the task.",
    })
  } else if (summary.found > 0) {
    toast.success("Task found", { description: describeVerification(summary) })
  }
}

function notifyImport(summary: ImportSummary): void {
  if (summary.added === 0) {
    toast.info(
      summary.duplicates > 0 ? "Already imported" : "No commits to import",
      {
        description:
          summary.duplicates > 0
            ? `${pluralize(summary.duplicates, "commit")} already in the list.`
            : "Merge commits and empty lines are skipped.",
      }
    )
    return
  }

  if (summary.verification.errorMessage !== null) {
    notifyVerification(summary.verification)
    return
  }

  const skipped =
    summary.duplicates > 0
      ? ` ${pluralize(summary.duplicates, "duplicate")} skipped.`
      : ""
  toast.success(`Imported ${pluralize(summary.added, "commit")}`, {
    description: `${describeVerification(summary.verification)}${skipped}`,
  })
}

function notifySubmission(summary: SubmissionSummary): void {
  if (summary.submitted > 0 && summary.failed === 0) {
    toast.success(
      `${pluralize(summary.submitted, "timesheet")} submitted to Odoo`
    )
  } else if (summary.submitted > 0) {
    toast.warning(`${summary.submitted} submitted, ${summary.failed} failed`, {
      description: summary.errorMessage ?? undefined,
    })
  } else if (summary.failed > 0) {
    toast.error(`Couldn't submit ${pluralize(summary.failed, "timesheet")}`, {
      description: summary.errorMessage ?? undefined,
    })
  }
}

export function DashboardPage() {
  const timesheet = useTimesheet()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const hasEntries = timesheet.entries.length > 0

  const openImportModal = (): void => setIsImportModalOpen(true)

  const handleFetchCommits = async (): Promise<void> => {
    try {
      notifyImport(await timesheet.importFromServer())
    } catch (error) {
      toast.error("Couldn't fetch today's commits", {
        description: error instanceof Error ? error.message : undefined,
        action: { label: "Paste instead", onClick: openImportModal },
      })
    }
  }

  const handlePasteImport = async (
    raw: string,
    date: string
  ): Promise<void> => {
    const summary = await timesheet.importFromText(raw, date)
    setIsImportModalOpen(false)
    notifyImport(summary)
  }

  const handleVerify = async (id: string): Promise<void> => {
    notifyVerification(await timesheet.verifyEntry(id))
  }

  const handleSubmit = async (id: string): Promise<void> => {
    notifySubmission(await timesheet.submitEntry(id))
  }

  const handleSubmitAll = async (): Promise<void> => {
    notifySubmission(await timesheet.submitAll())
  }

  const importActions = (
    <>
      <Button variant="outline" onClick={openImportModal}>
        <ClipboardPasteIcon />
        Paste commits
      </Button>
      <Button onClick={handleFetchCommits} disabled={timesheet.isImporting}>
        {timesheet.isImporting ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <GitCommitHorizontalIcon />
        )}
        Fetch today&apos;s commits
      </Button>
    </>
  )

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded-md bg-instance-1 text-[0.7rem] font-bold text-white"
            >
              P
            </span>
            Pointage
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pt-8 pb-36 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Today&apos;s timesheet
            </h1>
            <p className="text-sm text-muted-foreground">
              {formatLongDate(todayIsoDate())}
            </p>
          </div>
          {hasEntries && (
            <div className="flex flex-wrap gap-2">{importActions}</div>
          )}
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
          <TimesheetEmptyState>{importActions}</TimesheetEmptyState>
        )}
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
    </div>
  )
}
