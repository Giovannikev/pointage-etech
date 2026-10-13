import type { TimesheetReference } from "@/types/timesheet"

/** A timesheet line already in Odoo, as shown in the edit and delete dialogs. */
export interface EditableTimesheet extends TimesheetReference {
  /** YYYY-MM-DD */
  date: string
  hours: number
  description: string
  /** Task name, or project name for a line without a task. */
  label: string
}
