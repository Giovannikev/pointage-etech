import { Loader2Icon, UsersRoundIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ChecklistFilter } from "@/components/kanban/ChecklistFilter"
import {
  isAssigneeSelected,
  toggleAssignee,
  UNASSIGNED_KEY,
  type AssigneeOption,
} from "@/utils/taskFilters"

interface AssigneeFilterProps {
  /** undefined while the users load. */
  options: AssigneeOption[] | undefined
  /** Selected assignee keys ("1:7", "none"); empty means anyone. */
  value: ReadonlySet<string>
  onChange: (value: ReadonlySet<string>) => void
}

/** Picks the people whose tasks are shown, or the unassigned tasks. */
export function AssigneeFilter({
  options,
  value,
  onChange,
}: AssigneeFilterProps) {
  const { t } = useTranslation()
  const unassigned: AssigneeOption = {
    id: UNASSIGNED_KEY,
    name: t("allTasks.assigneeFilter.unassigned"),
    keys: [UNASSIGNED_KEY],
    isMe: false,
  }
  const all = [
    ...(options ?? []).filter((option) => option.isMe),
    unassigned,
    ...(options ?? []).filter((option) => !option.isMe),
  ]
  const byId = new Map(all.map((option) => [option.id, option]))

  return (
    <ChecklistFilter
      items={all.map((option) => ({
        id: option.id,
        label: option.name,
        suffix: option.isMe ? t("allTasks.assigneeFilter.me") : undefined,
        isPlaceholder: option.id === UNASSIGNED_KEY,
      }))}
      isSelected={(id) => {
        const option = byId.get(id)
        return option !== undefined && isAssigneeSelected(option, value)
      }}
      onToggle={(id) => {
        const option = byId.get(id)
        if (option !== undefined) onChange(toggleAssignee(option, value))
      }}
      onClear={() => onChange(new Set())}
      icon={<UsersRoundIcon />}
      showInstance={false}
      placeholder={
        options === undefined ? (
          <p className="flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            {t("allTasks.assigneeFilter.loading")}
          </p>
        ) : undefined
      }
      labels={{
        label: t("allTasks.assigneeFilter.label"),
        all: t("allTasks.assigneeFilter.all"),
        count: (count) => t("allTasks.assigneeFilter.count", { count }),
        search: t("allTasks.assigneeFilter.search"),
        noMatch: t("allTasks.assigneeFilter.noMatch"),
        clear: t("allTasks.assigneeFilter.clear"),
      }}
    />
  )
}
