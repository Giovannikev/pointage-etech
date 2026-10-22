import { useId, useMemo, useState, type ReactNode } from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex } from "@/types/timesheet"
import { normalizeText } from "@/utils/kanban"

/** Above this many items, a search field filters the list. */
const SEARCH_THRESHOLD = 8

export interface ChecklistItem {
  id: string
  label: string
  /** Shown after the label, e.g. "(you)"; also searched. */
  suffix?: string
  /** A placeholder entry such as "No project": shown in italics. */
  isPlaceholder?: boolean
  /** Colored dot of the instance the item comes from. */
  instanceIndex?: OdooInstanceIndex | null
  /** Shown on the right, e.g. how many tasks the item has. */
  count?: number | null
}

export interface ChecklistFilterLabels {
  /** Names the filter, for screen readers. */
  label: string
  /** Button text when nothing is picked. */
  all: string
  /** Button text when several items are picked. */
  count: (count: number) => string
  search: string
  noMatch: string
  clear: string
}

interface ChecklistFilterProps {
  items: ChecklistItem[]
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
  onClear: () => void
  icon: ReactNode
  labels: ChecklistFilterLabels
  /** Shows the instance dot of each item. */
  showInstance: boolean
  /** Shown in place of the list, e.g. while the items load. */
  placeholder?: ReactNode
}

/** Picks one or several items in a searchable popover list. */
export function ChecklistFilter({
  items,
  isSelected,
  onToggle,
  onClear,
  icon,
  labels,
  showInstance,
  placeholder,
}: ChecklistFilterProps) {
  const listId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")

  const visible = useMemo(() => {
    const words = normalizeText(search).split(/\s+/).filter(Boolean)
    return items.filter((item) => {
      const text = normalizeText(`${item.label} ${item.suffix ?? ""}`)
      return words.every((word) => text.includes(word))
    })
  }, [items, search])

  const selected = items.filter((item) => isSelected(item.id))
  const buttonText =
    selected.length === 0
      ? labels.all
      : selected.length === 1
        ? selected[0].label
        : labels.count(selected.length)

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
            aria-label={labels.label}
          >
            {icon}
            <span className="truncate">{buttonText}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0">
          {placeholder ?? (
            <>
              {items.length > SEARCH_THRESHOLD && (
                <div className="relative border-b p-2">
                  <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={search}
                    autoFocus
                    placeholder={labels.search}
                    aria-label={labels.search}
                    aria-controls={listId}
                    className="pl-8"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              )}

              <ul
                id={listId}
                aria-label={labels.label}
                className="grid max-h-72 overflow-y-auto p-1"
              >
                {visible.map((item) => {
                  const isChecked = isSelected(item.id)
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={isChecked}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => onToggle(item.id)}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                            isChecked &&
                              "border-primary bg-primary text-primary-foreground"
                          )}
                        >
                          {isChecked && <CheckIcon className="size-3" />}
                        </span>
                        {showInstance &&
                          item.instanceIndex !== undefined &&
                          item.instanceIndex !== null && (
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                INSTANCE_BACKGROUNDS[item.instanceIndex]
                              )}
                            />
                          )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            item.isPlaceholder && "text-muted-foreground italic"
                          )}
                          title={item.label}
                        >
                          {item.label}
                          {item.suffix !== undefined && (
                            <span className="text-muted-foreground">
                              {" "}
                              {item.suffix}
                            </span>
                          )}
                        </span>
                        {item.count !== undefined && item.count !== null && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {item.count}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
                {visible.length === 0 && (
                  <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {labels.noMatch}
                  </li>
                )}
              </ul>

              {selected.length > 0 && (
                <div className="border-t p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center"
                    onClick={onClear}
                  >
                    {labels.clear}
                  </Button>
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={labels.clear}
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}
