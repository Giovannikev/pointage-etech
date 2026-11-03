import type { OdooInstanceSettings, SettingsView } from "@/types/settings"
import type { OdooInstanceIndex, OdooTaskMatch } from "@/types/timesheet"

export const ODOO_INSTANCE_INDEXES: readonly OdooInstanceIndex[] = [1, 2]

/**
 * Timesheets need one Odoo instance. GitHub is optional: without it,
 * commits are pasted instead of fetched.
 */
export function isSetupComplete(settings: SettingsView): boolean {
  return settings.odooInstances.length > 0
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

/** Link to a helpdesk ticket's form in its Odoo instance. */
export function getTicketUrl(
  instances: OdooInstanceSettings[],
  instanceIndex: OdooInstanceIndex,
  ticketId: number
): string | null {
  const instance = instances.find((item) => item.index === instanceIndex)
  return instance === undefined
    ? null
    : `${instance.url}/web#id=${ticketId}&model=helpdesk.ticket&view_type=form`
}
