import { SettingsGate } from "@/components/settings/SettingsGate"
import { TaskBoard } from "@/components/kanban/TaskBoard"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"

interface TasksPageProps {
  onOpenSettings: () => void
}

/**
 * All tasks: any task or open helpdesk ticket, assigned to anyone, on the
 * same board as My tasks, with an assignee filter on top.
 */
export function TasksPage({ onOpenSettings }: TasksPageProps) {
  return (
    <main className="grid w-full min-w-0 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <TaskBoard scope="all" />
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
