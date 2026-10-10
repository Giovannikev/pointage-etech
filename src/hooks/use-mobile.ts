import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_QUERY)
  mediaQuery.addEventListener("change", onChange)
  return () => mediaQuery.removeEventListener("change", onChange)
}

function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

/** Used by the shadcn sidebar to switch to its mobile sheet. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport)
}
