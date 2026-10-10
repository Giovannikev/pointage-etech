import { useCallback, useRef, useState } from "react"

import { fetchTaskDetails } from "@/services/odooService"
import type { OdooTaskMatch, TaskDetails } from "@/types/timesheet"

type TaskDetailsContent =
  | { status: "loading" }
  | { status: "ready"; details: TaskDetails }
  | { status: "error"; message: string }

export interface TaskDetailsState {
  isOpen: boolean
  /** Kept after closing so the dialog doesn't empty during its exit animation. */
  task: OdooTaskMatch | null
  content: TaskDetailsContent
}

interface UseTaskDetailsResult {
  state: TaskDetailsState
  open: (task: OdooTaskMatch) => void
  close: () => void
}

/** Opens a task's details dialog and loads its description from Odoo. */
export function useTaskDetails(): UseTaskDetailsResult {
  const [state, setState] = useState<TaskDetailsState>({
    isOpen: false,
    task: null,
    content: { status: "loading" },
  })
  // Ignores the answer of a task the user already moved away from.
  const latestRequest = useRef(0)

  const open = useCallback((task: OdooTaskMatch): void => {
    const request = ++latestRequest.current
    setState({ isOpen: true, task, content: { status: "loading" } })

    fetchTaskDetails(task.instanceIndex, task.taskId).then(
      (details) => {
        if (request === latestRequest.current) {
          setState({
            isOpen: true,
            task,
            content: { status: "ready", details },
          })
        }
      },
      (error: unknown) => {
        if (request === latestRequest.current) {
          setState({
            isOpen: true,
            task,
            content: {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }
    )
  }, [])

  const close = useCallback((): void => {
    latestRequest.current += 1
    setState((current) => ({ ...current, isOpen: false }))
  }, [])

  return { state, open, close }
}
