/**
 * odoo-gateway — Supabase Edge Function (Deno)
 *
 * Bridges the dashboard to the signed-in user's Odoo instances through
 * Odoo's JSON-RPC API, with the credentials stored in their settings.
 *
 * Actions (POST body):
 *   { action: "SEARCH_TASK", taskRefs: string[] }
 *   { action: "SUBMIT_TIMESHEET", entries: TimesheetSubmission[] }
 *   { action: "FIND_TIMESHEETS", lookups: TimesheetLookup[] }
 *   { action: "GET_TASK", instanceIndex, taskId }
 *   { action: "GET_MY_TASKS", instanceIndex? }
 *   { action: "GET_TIMESHEET_HISTORY", dateFrom, dateTo, instanceIndex? }
 *   { action: "UPDATE_TIMESHEET", instanceIndex, timesheetId, hours, description }
 *   { action: "DELETE_TIMESHEET", instanceIndex, timesheetId }
 *   { action: "SEARCH_TASKS", query, instanceIndex? }
 *   { action: "SEARCH_TICKETS", query, mine, instanceIndex? }
 *   { action: "LOG_TICKET_TIME", instanceIndex, ticketId, hours, description, date }
 *   { action: "LIST_PROJECTS", instanceIndex }
 *   { action: "LIST_PROJECT_TASKS", instanceIndex, projectId, query? }
 *   { action: "UPDATE_TASK", instanceIndex, taskId, stageId?, status? }
 *   { action: "POST_TASK_NOTE", instanceIndex, taskId, note, approve }
 *   { action: "GET_TIME_OFF", instanceIndex? }
 *   { action: "REQUEST_TIME_OFF", instanceIndex, leaveTypeId, dateFrom, dateTo, period, hourFrom, hourTo, description }
 *   { action: "UPDATE_TIME_OFF", instanceIndex, leaveId, leaveTypeId, dateFrom, dateTo, period, hourFrom, hourTo, description }
 *   { action: "DELETE_TIME_OFF", instanceIndex, leaveId }
 *   { action: "GET_ATTENDANCE", dateFrom, dateTo, instanceIndex? }
 *   { action: "CHECK_IN_OUT", instanceIndex, direction? }
 *   { action: "LIST_TASKS", query?, projects?, assignees?, includeClosed, instanceIndex? }
 *   { action: "LIST_ASSIGNEES", instanceIndex? }
 *
 * This file only routes: the request contract is in contract.ts and
 * request.ts, and each domain has its module (timesheets, tasks, tickets,
 * leaves, attendance).
 */
import { readJsonBody, serveJson } from "../_shared/http.ts"
import { requireOdooInstances } from "../_shared/settings.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import { checkInOut, getAttendance } from "./attendance.ts"
import {
  deleteTimeOff,
  getTimeOff,
  requestTimeOff,
  updateTimeOff,
} from "./leaves.ts"
import { parseRequest } from "./request.ts"
import {
  getMyTasks,
  getTask,
  listAssignees,
  listProjects,
  listProjectTasks,
  listTasks,
  postTaskNote,
  searchAllTasks,
  updateTask,
} from "./tasks.ts"
import { logTicketTime, searchTickets } from "./tickets.ts"
import {
  deleteTimesheet,
  findTimesheets,
  getTimesheetHistory,
  searchTasks,
  submitTimesheets,
  updateTimesheet,
} from "./timesheets.ts"

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

serveJson("odoo-gateway", {
  POST: async ({ request, userId }) => {
    const gatewayRequest = parseRequest(await readJsonBody(request))
    const instances = requireOdooInstances(await loadSettings(userId))
    switch (gatewayRequest.action) {
      case "SEARCH_TASK":
        return {
          results: await searchTasks(instances, gatewayRequest.taskRefs),
        }
      case "SUBMIT_TIMESHEET":
        return {
          results: await submitTimesheets(instances, gatewayRequest.entries),
        }
      case "FIND_TIMESHEETS":
        return {
          results: await findTimesheets(instances, gatewayRequest.lookups),
        }
      case "GET_TASK":
        return { task: await getTask(instances, gatewayRequest) }
      case "GET_MY_TASKS":
        return {
          instances: await getMyTasks(instances, gatewayRequest.instanceIndex),
        }
      case "GET_TIMESHEET_HISTORY":
        return {
          instances: await getTimesheetHistory(instances, gatewayRequest),
        }
      case "UPDATE_TIMESHEET":
        return { timesheet: await updateTimesheet(instances, gatewayRequest) }
      case "DELETE_TIMESHEET":
        return { deleted: await deleteTimesheet(instances, gatewayRequest) }
      case "SEARCH_TASKS":
        return {
          instances: await searchAllTasks(
            instances,
            gatewayRequest.query,
            gatewayRequest.instanceIndex
          ),
        }
      case "SEARCH_TICKETS":
        return { instances: await searchTickets(instances, gatewayRequest) }
      case "LOG_TICKET_TIME":
        return await logTicketTime(instances, gatewayRequest)
      case "LIST_PROJECTS":
        return await listProjects(instances, gatewayRequest.instanceIndex)
      case "LIST_PROJECT_TASKS":
        return await listProjectTasks(instances, gatewayRequest)
      case "UPDATE_TASK":
        return { task: await updateTask(instances, gatewayRequest) }
      case "POST_TASK_NOTE":
        return await postTaskNote(instances, gatewayRequest)
      case "GET_TIME_OFF":
        return {
          instances: await getTimeOff(instances, gatewayRequest.instanceIndex),
        }
      case "REQUEST_TIME_OFF":
        return { request: await requestTimeOff(instances, gatewayRequest) }
      case "UPDATE_TIME_OFF":
        return { request: await updateTimeOff(instances, gatewayRequest) }
      case "DELETE_TIME_OFF":
        return { deleted: await deleteTimeOff(instances, gatewayRequest) }
      case "GET_ATTENDANCE":
        return { instances: await getAttendance(instances, gatewayRequest) }
      case "CHECK_IN_OUT":
        return await checkInOut(
          instances,
          gatewayRequest.instanceIndex,
          gatewayRequest.direction
        )
      case "LIST_TASKS":
        return { instances: await listTasks(instances, gatewayRequest) }
      case "LIST_ASSIGNEES":
        return {
          instances: await listAssignees(
            instances,
            gatewayRequest.instanceIndex
          ),
        }
    }
  },
})
