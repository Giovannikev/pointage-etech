import { useCallback, useEffect, useSyncExternalStore } from "react"

import type { AppView } from "@/types/navigation"

const APP_VIEWS: readonly AppView[] = [
  "timesheet",
  "kanban",
  "tasks",
  "history",
  "leaves",
  "settings",
]

export const DEFAULT_VIEW: AppView = "timesheet"

/** "#kanban" or "#kanban?group=project" -> "kanban"; null for an empty or unknown hash. */
export function parseViewHash(hash: string): AppView | null {
  const name = hash.replace(/^#\/?/, "").split("?")[0].toLowerCase()
  return APP_VIEWS.find((view) => view === name) ?? null
}

export function toViewHash(view: AppView): string {
  return `#${view}`
}

function readView(): AppView {
  return parseViewHash(window.location.hash) ?? DEFAULT_VIEW
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

/** Rewrites the hash without adding a history entry (no Back to an empty hash). */
function replaceHash(view: AppView): void {
  const { pathname, search } = window.location
  window.history.replaceState(
    window.history.state,
    "",
    `${pathname}${search}${toViewHash(view)}`
  )
}

export interface HashNavigation {
  view: AppView
  navigate: (view: AppView) => void
}

/**
 * The active view lives in the URL hash (#timesheet, #kanban, #history,
 * #settings), so a reload, a bookmark or the Back button keep the page.
 * A missing or unknown hash shows the timesheet and is silently replaced.
 */
export function useHashNavigation(): HashNavigation {
  const view = useSyncExternalStore(subscribe, readView, () => DEFAULT_VIEW)

  useEffect(() => {
    if (parseViewHash(window.location.hash) !== view) {
      replaceHash(view)
    }
  }, [view])

  const navigate = useCallback((next: AppView): void => {
    if (parseViewHash(window.location.hash) !== next) {
      // Assigning the hash adds a history entry and fires "hashchange".
      window.location.hash = toViewHash(next)
    }
  }, [])

  return { view, navigate }
}
