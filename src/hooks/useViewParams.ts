import { useEffect } from "react"

import type { AppView } from "@/types/navigation"
import { writeViewParams, type ViewParamValues } from "@/utils/viewParams"

/**
 * Mirrors a view's filters into its URL. Pages read the URL once, to seed
 * their state, then this keeps the URL in step with that state.
 */
export function useSyncViewParams(
  view: AppView,
  values: ViewParamValues
): void {
  // Serialized so the effect only runs when a value actually changes.
  const serialized = JSON.stringify(values)
  useEffect(() => {
    writeViewParams(view, JSON.parse(serialized) as ViewParamValues)
  }, [view, serialized])
}
