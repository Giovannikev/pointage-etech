import { ExternalLinkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { OdooRichText } from "@/components/OdooRichText"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useOdooInstances } from "@/contexts/SettingsContext"
import type { TaskDetailsState } from "@/hooks/useTaskDetails"
import { getTaskUrl } from "@/utils/settings"

interface TaskDetailsDialogProps {
  state: TaskDetailsState
  onClose: () => void
}

function TaskDescription({ content }: Pick<TaskDetailsState, "content">) {
  const { t } = useTranslation()
  switch (content.status) {
    case "loading":
      return (
        <div className="grid gap-2" aria-label={t("taskDetails.loading")}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )
    case "error":
      return <p className="text-sm text-destructive">{content.message}</p>
    case "ready":
      return (
        <OdooRichText
          html={content.details.descriptionHtml}
          emptyText={t("taskDetails.empty")}
        />
      )
  }
}

export function TaskDetailsDialog({ state, onClose }: TaskDetailsDialogProps) {
  const { t } = useTranslation()
  const instances = useOdooInstances()
  const { task, content } = state
  const taskUrl = task === null ? null : getTaskUrl(instances, task)
  const stageName =
    content.status === "ready" ? content.details.stageName : null

  return (
    <Dialog open={state.isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {task !== null && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 leading-snug">
                {content.status === "ready"
                  ? content.details.name
                  : task.taskName}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <InstanceBadge instanceIndex={task.instanceIndex} />
                  <span>{task.projectName}</span>
                  {stageName !== null && (
                    <Badge variant="outline">{stageName}</Badge>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="-mx-4 max-h-[65vh] overflow-y-auto border-t px-4 pt-4">
              <TaskDescription content={content} />
            </div>

            {taskUrl !== null && (
              <DialogFooter>
                <Button variant="outline" asChild>
                  <a href={taskUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon />
                    {t("common.openInOdoo")}
                  </a>
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
