import { useCallback, useState } from "react"

export interface DialogTarget<T> {
  /** Kept after closing, so the dialog doesn't empty during its exit animation. */
  target: T | null
  isOpen: boolean
  open: (target: T) => void
  close: () => void
}

/** Open state of a dialog acting on one item (a task, a timesheet line...). */
export function useDialogTarget<T>(): DialogTarget<T> {
  const [state, setState] = useState<{ target: T | null; isOpen: boolean }>({
    target: null,
    isOpen: false,
  })
  const open = useCallback((target: T): void => {
    setState({ target, isOpen: true })
  }, [])
  const close = useCallback((): void => {
    setState((current) => ({ ...current, isOpen: false }))
  }, [])
  return { ...state, open, close }
}
