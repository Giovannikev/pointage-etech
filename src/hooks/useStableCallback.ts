import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * A function whose identity never changes but which always runs the latest
 * `callback`: memoized children receiving it don't re-render, and never act
 * on the state of an older render. Meant for event handlers, not for render.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useRef(callback)
  // Updated once the render is committed: events only fire after that.
  useLayoutEffect(() => {
    latest.current = callback
  })
  return useCallback((...args: Args) => latest.current(...args), [])
}
