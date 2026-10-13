import { useId, useMemo, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  FolderKanbanIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import { normalizeText, type ProjectOption } from "@/utils/kanban"

/** Above this many projects, a search field filters the list. */
const SEARCH_THRESHOLD = 8

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
  const listId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")

  const nameOf = (option: ProjectOption): string =>
    option.name ?? t("kanban.projectFilter.noProject")

  const visible = useMemo(() => {
    const words = normalizeText(search).split(/\s+/).filter(Boolean)
    return options.filter((option) => {
      const name = normalizeText(option.name ?? "")
      return words.every((word) => name.includes(word))
    })
  }, [options, search])

  const selected = options.filter((option) => value.has(option.key))
  const label =
    selected.length === 0
      ? t("kanban.projectFilter.all")
      : selected.length === 1
        ? nameOf(selected[0])
        : t("kanban.projectFilter.count", { count: selected.length })

  const toggle = (key: string): void => {
    const next = new Set(value)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange(next)
  }

  const handleOpenChange = (open: boolean): void => {
    setIsOpen(open)
    if (!open) {
      setSearch("")
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("max-w-64", selected.length > 0 && "border-ring")}
            aria-label={t("kanban.projectFilter.label")}
          >
            <FolderKanbanIcon />
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0">
          {options.length > SEARCH_THRESHOLD && (
            <div className="relative border-b p-2">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                autoFocus
                placeholder={t("kanban.projectFilter.search")}
                aria-label={t("kanban.projectFilter.search")}
                aria-controls={listId}
                className="pl-8"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}

          <ul
            id={listId}
            aria-label={t("kanban.projectFilter.label")}
            className="grid max-h-72 overflow-y-auto p-1"
          >
            {visible.map((option) => {
              const isSelected = value.has(option.key)
              return (
                <li key={option.key}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => toggle(option.key)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        isSelected &&
                          "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isSelected && <CheckIcon className="size-3" />}
                    </span>
                    {showInstance && option.instanceIndex !== null && (
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          INSTANCE_BACKGROUNDS[option.instanceIndex]
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        option.name === null && "text-muted-foreground italic"
                      )}
                      title={nameOf(option)}
                    >
                      {nameOf(option)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {option.taskCount}
                    </span>
                  </button>
                </li>
              )
            })}
            {visible.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                {t("kanban.projectFilter.noMatch")}
              </li>
            )}
          </ul>

          {selected.length > 0 && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={() => onChange(new Set())}
              >
                {t("kanban.projectFilter.clear")}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t("kanban.projectFilter.clear")}
          onClick={() => onChange(new Set())}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}
