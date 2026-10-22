import { FolderKanbanIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ChecklistFilter } from "@/components/kanban/ChecklistFilter"
import type { ProjectOption } from "@/utils/kanban"

interface ProjectFilterProps {
  options: ProjectOption[]
  /** Selected project keys; empty means every project. */
  value: ReadonlySet<string>
  onChange: (value: ReadonlySet<string>) => void
  /** Shows which instance each project comes from. */
  showInstance: boolean
}

/** Picks one or several projects; the board shows only their tasks. */
export function ProjectFilter({
  options,
  value,
  onChange,
  showInstance,
}: ProjectFilterProps) {
  const { t } = useTranslation()

  const toggle = (key: string): void => {
    const next = new Set(value)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange(next)
  }

  return (
    <ChecklistFilter
      items={options.map((option) => ({
        id: option.key,
        label: option.name ?? t("kanban.projectFilter.noProject"),
        isPlaceholder: option.name === null,
        instanceIndex: option.instanceIndex,
        count: option.taskCount,
      }))}
      isSelected={(key) => value.has(key)}
      onToggle={toggle}
      onClear={() => onChange(new Set())}
      icon={<FolderKanbanIcon />}
      showInstance={showInstance}
      labels={{
        label: t("kanban.projectFilter.label"),
        all: t("kanban.projectFilter.all"),
        count: (count) => t("kanban.projectFilter.count", { count }),
        search: t("kanban.projectFilter.search"),
        noMatch: t("kanban.projectFilter.noMatch"),
        clear: t("kanban.projectFilter.clear"),
      }}
    />
  )
}
