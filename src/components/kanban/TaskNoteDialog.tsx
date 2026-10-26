import { useId, useState, type FormEvent } from "react"
import { Loader2Icon, NotebookPenIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
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
import { postTaskNote } from "@/services/odooService"
import type { KanbanTask } from "@/types/timesheet"
import { splitTaskName } from "@/utils/kanban"

interface TaskNoteDialogProps {
  open: boolean
  task: KanbanTask | null
  /** The task's instance lets tasks be set to approved. */
  canApprove: boolean
  onOpenChange: (open: boolean) => void
  /** The task as Odoo holds it after the note. */
  onPosted: (task: KanbanTask, approved: boolean) => void
}

function TaskNoteForm({
  task,
  canApprove,
  onPosted,
}: {
  task: KanbanTask
  canApprove: boolean
  onPosted: TaskNoteDialogProps["onPosted"]
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const [note, setNote] = useState("")
  const [approve, setApprove] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canPost = note.trim() !== "" && !isPosting

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canPost) {
      return
    }
    setIsPosting(true)
    setError(null)
    const approved = canApprove && approve
    try {
      const saved = await postTaskNote({
        instanceIndex: task.instanceIndex,
        taskId: task.taskId,
        note,
        approve: approved,
      })
      onPosted(saved, approved)
    } catch (postError) {
      setError(
        postError instanceof Error ? postError.message : String(postError)
      )
      setIsPosting(false)
    }
  }

  const { ref, title } = splitTaskName(task.name)

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("taskNote.title")}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InstanceBadge instanceIndex={task.instanceIndex} />
            {task.projectName !== null && (
              <span className="truncate">{task.projectName}</span>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      <p className="leading-snug font-medium">
        {ref !== null && (
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            [{ref}]
          </span>
        )}
        {title}
      </p>

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-note`}>{t("taskNote.note")}</Label>
        <Textarea
          id={`${fieldId}-note`}
          value={note}
          placeholder={t("taskNote.placeholder")}
          autoFocus
          className="max-h-[50vh] min-h-40 font-mono text-xs"
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("taskNote.hint")}</p>
      </div>

      {canApprove && (
        <Label className="flex items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={approve}
            onChange={(event) => setApprove(event.target.checked)}
          />
          {t("taskNote.approve")}
        </Label>
      )}

      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPosting}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canPost}>
          {isPosting ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <NotebookPenIcon />
          )}
          {t("taskNote.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Posts an internal note in a task's chatter, from a card. */
export function TaskNoteDialog({
  open,
  task,
  canApprove,
  onOpenChange,
  onPosted,
}: TaskNoteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {task !== null && (
          <TaskNoteForm
            key={`${task.instanceIndex}:${task.taskId}`}
            task={task}
            canApprove={canApprove}
            onPosted={onPosted}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
