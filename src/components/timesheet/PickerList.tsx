import { useMemo, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSourceQuery, type CachedQuerySource } from "@/hooks/useCachedQuery"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { cn } from "@/lib/utils"

/** What a picker shows once its data is read. */
export type PickerView<Item> =
  | {
      status: "list"
      items: Item[]
      /** Shown in place of the rows when there are none. */
      emptyMessage: string
      /** Under the list: a hint, or that Odoo returned only the first rows. */
      note: string | null
    }
  /** The data was read but can't be listed, e.g. its instance failed. */
  | { status: "error"; message: string }
  /** Nothing to pick from, e.g. the instance has no helpdesk. */
  | { status: "message"; message: string }

/** What a picker lists and how; memoized by the caller. */
export interface PickerSource<Data, Item> {
  /** The list's accessible name. */
  label: string
  /** Height limit of the list, a Tailwind class. */
  maxHeightClass: string
  /** The search sent to Odoo for what was typed (debounced); "" when none. */
  serverQuery: (typed: string) => string
  /** The cached read behind the list, for that search. */
  read: (serverQuery: string) => CachedQuerySource<Data>
  /** What the list shows for the data read and the search typed. */
  view: (data: Data, search: string, serverQuery: string) => PickerView<Item>
  getKey: (item: Item) => number
  /** Rows shown but not selectable. */
  isDisabled?: (item: Item) => boolean
  /** The row's content, after the check mark. */
  renderItem: (item: Item) => ReactNode
}

function ListSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1.5 p-1" aria-label={t("common.loading")}>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  )
}

function ListError({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid justify-items-start gap-2 p-3 text-sm" role="alert">
      <p className="text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("common.tryAgain")}
      </Button>
    </div>
  )
}

/** A selectable row of a picker. */
function OptionRow({
  isSelected,
  onSelect,
  disabled = false,
  children,
}: {
  isSelected: boolean
  onSelect: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={isSelected}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
          isSelected && "bg-muted font-medium"
        )}
        onClick={onSelect}
      >
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center"
        >
          {isSelected && <CheckIcon className="size-4 text-primary" />}
        </span>
        {children}
      </button>
    </li>
  )
}

interface PickerListProps<Data, Item> {
  source: PickerSource<Data, Item>
  /** What the user typed in the picker's search field. */
  search: string
  listId: string
  /** Key of the picked item, if it is in this list. */
  selectedKey: number | null
  onSelect: (item: Item) => void
}

/**
 * A searchable list of Odoo records to pick one from (projects, tasks,
 * tickets). The list is filtered as the user types; when the source says
 * so, the search also runs in Odoo once typing pauses.
 */
export function PickerList<Data, Item>({
  source,
  search,
  listId,
  selectedKey,
  onSelect,
}: PickerListProps<Data, Item>) {
  const typed = useDebouncedValue(search.trim(), 350)
  const serverQuery = source.serverQuery(typed)
  const querySource = useMemo(
    () => source.read(serverQuery),
    [source, serverQuery]
  )
  const query = useSourceQuery(querySource)
  const view = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : source.view(query.data, search, serverQuery),
    [source, query.data, search, serverQuery]
  )

  if (query.isLoading) return <ListSkeleton />
  if (view === undefined) {
    return <ListError message={query.error} onRetry={query.refresh} />
  }
  if (view.status === "error") {
    return <ListError message={view.message} onRetry={query.refresh} />
  }
  if (view.status === "message") {
    return (
      <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
        {view.message}
      </p>
    )
  }

  return (
    <>
      <ul
        id={listId}
        aria-label={source.label}
        className={cn(
          "grid overflow-y-auto rounded-lg border p-1",
          source.maxHeightClass
        )}
      >
        {view.items.map((item) => {
          const key = source.getKey(item)
          return (
            <OptionRow
              key={key}
              isSelected={key === selectedKey}
              disabled={source.isDisabled?.(item) ?? false}
              onSelect={() => onSelect(item)}
            >
              {source.renderItem(item)}
            </OptionRow>
          )
        })}
        {view.items.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {view.emptyMessage}
          </li>
        )}
      </ul>
      {view.note !== null && (
        <p className="text-xs text-muted-foreground">{view.note}</p>
      )}
    </>
  )
}
