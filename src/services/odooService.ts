/**
 * Every call to the odoo-gateway Edge Function, split by domain under
 * `@/services/odoo/`; re-exported here so the app imports one module.
 */
export { clearOdooCache } from "@/services/odoo/shared"
export * from "@/services/odoo/attendance"
export * from "@/services/odoo/leaves"
export * from "@/services/odoo/projects"
export * from "@/services/odoo/tasks"
export * from "@/services/odoo/tickets"
export * from "@/services/odoo/timesheets"
