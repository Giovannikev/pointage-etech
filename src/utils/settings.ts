import type { OdooInstanceSettings, SettingsView } from "@/types/settings"
import type { OdooInstanceIndex, OdooTaskMatch } from "@/types/timesheet"

export const ODOO_INSTANCE_INDEXES: readonly OdooInstanceIndex[] = [1, 2]

/** Commits need a GitHub token, timesheets need at least one Odoo instance. */
export function isSetupComplete(settings: SettingsView): boolean {
  return settings.github !== null && settings.odooInstances.length > 0
}

export function getInstanceLabel(
  instances: OdooInstanceSettings[],
  index: OdooInstanceIndex
): string {
  return (
    instances.find((instance) => instance.index === index)?.label ??
    `Instance ${index}`
  )
}

/** Link to the task form; Odoo 17+ still redirects this classic URL. */
export function getTaskUrl(
  instances: OdooInstanceSettings[],
  task: OdooTaskMatch
): string | null {
  const instance = instances.find((item) => item.index === task.instanceIndex)
  return instance === undefined
    ? null
    : `${instance.url}/web#id=${task.taskId}&model=project.task&view_type=form`
}
