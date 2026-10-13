import type { AppView } from "@/types/navigation"
import type { OdooInstanceIndex } from "@/types/timesheet"

/**
 * Filters of a view live after its hash: "#history?from=2026-10-01&to=...".
 * A reload or a shared link then reopens the same filters.
 */

/** Values to write; empty strings, null and undefined are left out. */
export type ViewParamValues = Record<string, string | null | undefined>

/** The parameters after "?" in a hash such as "#kanban?group=project". */
export function parseHashParams(hash: string): URLSearchParams {
  const query = hash.indexOf("?")
  return new URLSearchParams(query === -1 ? "" : hash.slice(query + 1))
}

export function buildViewHash(view: AppView, values: ViewParamValues): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(name, value)
    }
  }
  const query = params.toString()
  return query === "" ? `#${view}` : `#${view}?${query}`
}

/** The parameters of the current URL. */
export function readViewParams(): URLSearchParams {
  return parseHashParams(window.location.hash)
}

/**
 * Rewrites the current URL's parameters without adding a history entry: the
 * Back button goes to the previous page, not to the previous filter.
 */
export function writeViewParams(view: AppView, values: ViewParamValues): void {
  const hash = buildViewHash(view, values)
  if (window.location.hash !== hash) {
    const { pathname, search } = window.location
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${search}${hash}`
    )
  }
}

export function parseInstanceParam(
  value: string | null
): "all" | OdooInstanceIndex {
  if (value === "1") return 1
  if (value === "2") return 2
  return "all"
}

export function formatInstanceParam(
  value: "all" | OdooInstanceIndex
): string | null {
  return value === "all" ? null : String(value)
}
