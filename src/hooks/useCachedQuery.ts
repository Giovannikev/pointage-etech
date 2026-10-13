import { useCallback, useEffect, useRef, useState } from "react"

export interface CachedQueryResult<T> {
  /** Last loaded data for the current key; undefined until the first load. */
  data: T | undefined
  error: string | null
  /** True while nothing can be shown yet for the current key. */
  isLoading: boolean
  /** True while a manual refresh runs over data already shown. */
  isRefreshing: boolean
  /** Reads Odoo again, bypassing the cache. */
  refresh: () => void
  /** Replaces the shown data locally, e.g. after an edit. */
  mutate: (update: (current: T) => T) => void
}

interface Snapshot<T> {
  key: string
  data: T | undefined
  error: string | null
  isRefreshing: boolean
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Loads data through a cache-aware fetcher. A fresh cached value is shown at
 * once (no loading state when coming back to a page); answers for a key the
 * user already left are ignored.
 *
 * `fetcher` and `peek` must be memoized by the caller for the current key.
 */
export function useCachedQuery<T>(
  key: string,
  fetcher: (options: { force: boolean }) => Promise<T>,
  peek: () => T | undefined
): CachedQueryResult<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    key,
    data: peek(),
    error: null,
    isRefreshing: false,
  }))
  const [reloadToken, setReloadToken] = useState(0)
  const forceNextLoad = useRef(false)

  useEffect(() => {
    const force = forceNextLoad.current
    forceNextLoad.current = false
    let isCurrent = true

    fetcher({ force }).then(
      (data) => {
        if (isCurrent) {
          setSnapshot({ key, data, error: null, isRefreshing: false })
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setSnapshot((current) => ({
            key,
            // Keep what is shown for this key; a refresh error isn't a blank page.
            data: current.key === key ? current.data : undefined,
            error: toMessage(error),
            isRefreshing: false,
          }))
        }
      }
    )
    return () => {
      isCurrent = false
    }
  }, [key, fetcher, reloadToken])

  const refresh = useCallback((): void => {
    forceNextLoad.current = true
    setSnapshot((current) => ({ ...current, isRefreshing: true }))
    setReloadToken((token) => token + 1)
  }, [])

  const mutate = useCallback(
    (update: (current: T) => T): void => {
      setSnapshot((current) =>
        current.key === key && current.data !== undefined
          ? { ...current, data: update(current.data) }
          : current
      )
    },
    [key]
  )

  // Switching key shows the cached value for the new key, if any, right away.
  const isSameKey = snapshot.key === key
  const data = isSameKey ? snapshot.data : peek()
  const error = isSameKey ? snapshot.error : null

  return {
    data,
    error,
    isLoading: data === undefined && error === null,
    isRefreshing: isSameKey && snapshot.isRefreshing,
    refresh,
    mutate,
  }
}
