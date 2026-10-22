import { SettingsGate } from "@/components/settings/SettingsGate"
import { TaskBoard } from "@/components/kanban/TaskBoard"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"

interface KanbanPageProps {
  onOpenSettings: () => void
}

/** My tasks: the tasks and open tickets assigned to the user, on a board. */
export function KanbanPage({ onOpenSettings }: KanbanPageProps) {
  return (
    <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <TaskBoard scope="mine" />
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
