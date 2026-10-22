import { useCallback, useEffect, useRef, useState } from "react"

import { fetchDeployedVersion, isNewDeployment } from "@/utils/appVersion"

const CHECK_INTERVAL_MS = 3 * 60_000

/**
 * Drops the cached app (Cache Storage, used by the PWA service worker),
 * asks the service worker for its new version, then reloads: the same as
 * Ctrl + Shift + R. Reloads even when a step fails, so the button always
 * does something.
 */
export async function hardReload(): Promise<void> {
  try {
    if ("caches" in window) {
      const names = await caches.keys()
      await Promise.allSettled(names.map((name) => caches.delete(name)))
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.allSettled(
        registrations.map((registration) => registration.update())
      )
    }
  } finally {
    window.location.reload()
  }
}

export interface VersionCheck {
  /** A newer deployment is online and the user hasn't dismissed the notice. */
  isUpdateAvailable: boolean
  /** Hides the notice until an even newer deployment comes online. */
  dismiss: () => void
}

/**
 * Watches for a newer deployment while the app is open: every 3 minutes and
 * each time the tab comes back into view. The version deployed is compared
 * with the one this bundle was built from, so an app opened from the PWA
 * cache after a deployment is told too. Off in the dev server.
 */
export function useVersionCheck(): VersionCheck {
  /** The newer version found online, if any. */
  const [available, setAvailable] = useState<string | null>(null)
  /** The version whose notice the user closed: closing it isn't undone. */
  const dismissed = useRef<string | null>(null)

  useEffect(() => {
    const running = __APP_VERSION__
    if (running === null) {
      return
    }
    let isActive = true
    let isChecking = false

    const check = async (): Promise<void> => {
      // A hidden tab waits: the check runs again when it comes back.
      if (isChecking || document.visibilityState !== "visible") {
        return
      }
      isChecking = true
      try {
        const deployed = await fetchDeployedVersion()
        if (
          !isActive ||
          !isNewDeployment(running, deployed) ||
          deployed === dismissed.current
        ) {
          return
        }
        setAvailable(deployed)
      } finally {
        isChecking = false
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void check()
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      isActive = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  const dismiss = useCallback((): void => {
    dismissed.current = available
    setAvailable(null)
  }, [available])

  return { isUpdateAvailable: available !== null, dismiss }
}
