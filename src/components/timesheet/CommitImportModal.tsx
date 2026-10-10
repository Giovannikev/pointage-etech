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
import { parseCommitLog } from "@/utils/commitParser"
import { todayIsoDate } from "@/utils/date"

const PLACEHOLDER = [
  "[03-500] matelec_sale: add french translations",
  "[03-512] matelec_stock: fix rounding on delivery order",
  "a1b2c3d [03-498] update access rights",
].join("\n")

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

  const commits = useMemo(() => parseCommitLog(raw), [raw])
  const withoutRef = commits.filter((commit) => commit.taskRef === null).length
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
