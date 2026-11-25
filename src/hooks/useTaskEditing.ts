import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type {
  CardEditingActions,
  CardEditingState,
} from "@/components/kanban/KanbanCard"
import type {
  BoardCardEditing,
  ColumnDrop,
} from "@/components/kanban/KanbanColumn"
import { useStableCallback } from "@/hooks/useStableCallback"
import { updateTask } from "@/services/odooService"
import type {
  KanbanStage,
  KanbanTask,
  KanbanTaskStatus,
  MyTasksInstanceResult,
} from "@/types/timesheet"
import {
  findColumnStage,
  isClosedTask,
  listMoveTargets,
  moveToStage,
  replaceTask,
  statusOptionsOf,
  taskKey,
  type BoardColumn,
  type BoardGrouping,
} from "@/utils/kanban"

interface TaskEditingOptions {
  /** The board's tasks; undefined until read. */
  data: MyTasksInstanceResult[] | undefined
  /** Replaces the shown tasks locally. */
  mutateTasks: (
    update: (results: MyTasksInstanceResult[]) => MyTasksInstanceResult[]
  ) => void
  groupBy: BoardGrouping
  showClosed: boolean
  /** Opens the dialog posting a note in the task's chatter. */
  onLogNote: (task: KanbanTask) => void
}

interface TaskEditing {
  /** What the columns need to let their cards edit tasks. */
  cardEditing: BoardCardEditing
  /** The drop target a column offers to the dragged card, if any. */
  columnDrop: (column: BoardColumn) => ColumnDrop | undefined
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Stage (drag and drop, menu) and state (badge) changes of the board's
 * tasks. The card handlers keep one identity for the board's life and read
 * its latest tasks when called, so memoized cards never act on old data.
 */
export function useTaskEditing({
  data,
  mutateTasks,
  groupBy,
  showClosed,
  onLogNote,
}: TaskEditingOptions): TaskEditing {
  const { t } = useTranslation()
  /** Tasks whose change is being saved in Odoo, by taskKey(). */
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set())
  /** The card being dragged, while it is. */
  const [dragged, setDragged] = useState<KanbanTask | null>(null)

  const setSavingFor = useCallback((key: string, isSaving: boolean): void => {
    setSaving((current) => {
      const next = new Set(current)
      if (isSaving) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /**
   * Shows the change at once, saves it in Odoo, then shows the task as Odoo
   * holds it (moving may reset its state); on failure, puts it back.
   */
  const saveTask = useCallback(
    async (
      before: KanbanTask,
      optimistic: KanbanTask,
      change: { stageId?: number; status?: KanbanTaskStatus }
    ): Promise<KanbanTask> => {
      const key = taskKey(before)
      setSavingFor(key, true)
      mutateTasks((results) => replaceTask(results, optimistic))
      try {
        const saved = await updateTask({
          instanceIndex: before.instanceIndex,
          taskId: before.taskId,
          ...change,
        })
        mutateTasks((results) => replaceTask(results, saved))
        return saved
      } catch (error) {
        mutateTasks((results) => replaceTask(results, before))
        throw error
      } finally {
        setSavingFor(key, false)
      }
    },
    [mutateTasks, setSavingFor]
  )

  /** moveTask itself, for the "Undo" button of a move's notification. */
  const moveTaskRef = useRef<
    ((task: KanbanTask, stage: KanbanStage) => Promise<void>) | null
  >(null)

  const moveTask = useStableCallback(
    async (task: KanbanTask, stage: KanbanStage): Promise<void> => {
      const previous =
        data === undefined
          ? undefined
          : listMoveTargets(data, moveToStage(task, stage)).find(
              (candidate) => candidate.stageId === task.stageId
            )
      try {
        const saved = await saveTask(task, moveToStage(task, stage), {
          stageId: stage.stageId,
        })
        const isHidden = !showClosed && isClosedTask(saved, stage)
        toast.success(t("kanban.moved", { stage: stage.name }), {
          description: isHidden
            ? `${task.name} — ${t("kanban.movedHidden")}`
            : task.name,
          action:
            previous === undefined
              ? undefined
              : {
                  label: t("kanban.undo"),
                  onClick: () => void moveTaskRef.current?.(saved, previous),
                },
        })
      } catch (error) {
        toast.error(t("kanban.moveError"), {
          description: toMessage(error),
        })
      }
    }
  )

  useEffect(() => {
    moveTaskRef.current = moveTask
  }, [moveTask])

  const changeStatus = useStableCallback(
    async (task: KanbanTask, status: KanbanTaskStatus): Promise<void> => {
      try {
        const saved = await saveTask(task, { ...task, status }, { status })
        const label = t(`kanban.status.${saved.status ?? "in_progress"}`)
        toast.success(t("kanban.statusChanged", { status: label }), {
          description: task.name,
        })
      } catch (error) {
        toast.error(t("kanban.statusError"), {
          description: toMessage(error),
        })
      }
    }
  )

  const getMoveTargets = useStableCallback((task: KanbanTask) =>
    data === undefined ? [] : listMoveTargets(data, task)
  )
  const logNote = useStableCallback(onLogNote)

  // Every handler is stable, so the object is created once.
  const actions = useMemo(
    (): CardEditingActions => ({
      getMoveTargets,
      onChangeStatus: (task, status) => void changeStatus(task, status),
      onMove: (task, stage) => void moveTask(task, stage),
      onLogNote: logNote,
      onDragStart: setDragged,
      onDragEnd: () => setDragged(null),
    }),
    [getMoveTargets, changeStatus, moveTask, logNote]
  )

  const stateOf = useCallback(
    (task: KanbanTask): CardEditingState => ({
      statusOptions: statusOptionsOf(data, task.instanceIndex),
      isSaving: saving.has(taskKey(task)),
      // Dropping changes the stage: only columns that are stages accept it.
      isDraggable: groupBy === "stage" && task.projectId !== null,
    }),
    [data, saving, groupBy]
  )

  const cardEditing = useMemo(
    (): BoardCardEditing => ({ actions, stateOf }),
    [actions, stateOf]
  )

  const columnDrop = (column: BoardColumn): ColumnDrop | undefined => {
    if (dragged === null || data === undefined) return undefined
    const draggedKey = taskKey(dragged)
    return {
      stage: findColumnStage(data, dragged, column.key),
      isSource: column.cards.some(
        (card) => card.kind === "task" && taskKey(card.task) === draggedKey
      ),
      onDrop: (stage) => {
        const task = dragged
        setDragged(null)
        void moveTask(task, stage)
      },
    }
  }

  return { cardEditing, columnDrop }
}
