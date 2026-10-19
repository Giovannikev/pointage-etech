import { useMemo, useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

import { DatePicker } from "@/components/timesheet/DatePicker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFormatters } from "@/hooks/useFormatters"
import { parsePastedCommits, type PastedCommit } from "@/utils/commitParser"
import { todayIsoDate } from "@/utils/date"

const PLACEHOLDER = [
  "[03-500] matelec_sale: add french translations",
  "14:32 [03-512] matelec_stock: fix rounding on delivery order",
  "a1b2c3d 2026-10-19 16:05 [03-498] update access rights",
].join("\n")

/** Long pastes only preview their first commits; all of them are imported. */
const PREVIEW_LIMIT = 50

/** The detected commits, each with its local time when one was pasted. */
function CommitPreview({
  commits,
  date,
}: {
  commits: PastedCommit[]
  date: string
}) {
  const { t } = useTranslation()
  const { formatShortDate, formatTime } = useFormatters()
  const shown = commits.slice(0, PREVIEW_LIMIT)
  const dayLabel = formatShortDate(date)

  return (
    <ul
      aria-label={t("pasteDialog.preview")}
      className="grid max-h-44 gap-0.5 overflow-y-auto rounded-lg border p-1.5"
    >
      {shown.map(({ commit, authoredAt }) => {
        const time = authoredAt === null ? null : formatTime(authoredAt)
        return (
          <li
            key={commit.rawMessage}
            className="flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-xs"
          >
            <span className="shrink-0 text-muted-foreground">{dayLabel}</span>
            <span
              className="w-10 shrink-0 font-mono text-muted-foreground tabular-nums"
              title={time === null ? t("pasteDialog.noTime") : undefined}
            >
              {time ?? "—"}
            </span>
            <span
              className="min-w-0 truncate font-mono"
              title={commit.rawMessage}
            >
              {commit.rawMessage}
            </span>
          </li>
        )
      })}
      {commits.length > shown.length && (
        <li className="px-1.5 py-1 text-xs text-muted-foreground">
          {t("pasteDialog.moreCommits", {
            count: commits.length - shown.length,
          })}
        </li>
      )}
    </ul>
  )
}

interface CommitImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolves once the commits are imported; the modal then closes. */
  onImport: (raw: string, date: string) => Promise<void>
}

function CommitImportForm({
  onImport,
}: Pick<CommitImportModalProps, "onImport">) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState("")
  const [date, setDate] = useState(todayIsoDate)
  const [isImporting, setIsImporting] = useState(false)

  const commits = useMemo(() => parsePastedCommits(raw, date), [raw, date])
  const withoutRef = commits.filter(
    ({ commit }) => commit.taskRef === null
  ).length
  const withoutTime = commits.filter(
    ({ authoredAt }) => authoredAt === null
  ).length
  const canImport = commits.length > 0 && !isImporting

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canImport) {
      return
    }
    setIsImporting(true)
    try {
      await onImport(raw, date)
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("pasteDialog.title")}</DialogTitle>
        <DialogDescription>
          <Trans
            i18nKey="pasteDialog.description"
            components={{ code: <code /> }}
          />
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="commit-messages">{t("pasteDialog.messages")}</Label>
        <Textarea
          id="commit-messages"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoFocus
          className="min-h-44 font-mono text-xs leading-relaxed"
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {commits.length === 0
            ? t("pasteDialog.noneDetected")
            : [
                t("pasteDialog.detected", { count: commits.length }),
                withoutRef > 0
                  ? t("pasteDialog.withoutReference", { count: withoutRef })
                  : "",
              ].join(" ")}
        </p>
        {commits.length > 0 && <CommitPreview commits={commits} date={date} />}
        {withoutTime > 0 && (
          <p className="text-xs text-muted-foreground">
            <Trans
              i18nKey="pasteDialog.timeHint"
              components={{ code: <code /> }}
            />
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:max-w-48">
        <Label htmlFor="timesheet-date">{t("pasteDialog.date")}</Label>
        <DatePicker id="timesheet-date" value={date} onChange={setDate} />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canImport}>
          {isImporting && <Loader2Icon className="animate-spin" />}
          {commits.length > 0
            ? t("pasteDialog.importCount", { count: commits.length })
            : t("pasteDialog.import")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CommitImportModal({
  open,
  onOpenChange,
  onImport,
}: CommitImportModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Radix unmounts the content when closed, so the form starts empty on each open */}
        <CommitImportForm onImport={onImport} />
      </DialogContent>
    </Dialog>
  )
}
