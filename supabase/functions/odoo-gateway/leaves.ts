import { readOwnEmployeeId } from "../_shared/attendance.ts"
import { HttpError } from "../_shared/errors.ts"
import {
  LEAVE_SPAN_FIELDS,
  LEAVE_STATES,
  readPublicHolidayRecords,
} from "../_shared/leaves.ts"
import {
  createSessionPool,
  executeKw,
  OdooRpcError,
  type OdooSession,
  readMany2one,
} from "../_shared/odoo.ts"
import { getModelFields, optionalModelFields } from "../_shared/odooFields.ts"
import type {
  InstanceIndex,
  OdooInstanceSettings,
} from "../_shared/settings.ts"
import { isPositiveInteger, isRecord } from "../_shared/validation.ts"
import type {
  LeaveReference,
  LeaveRequest,
  LeaveType,
  LeaveUnit,
  PublicHoliday,
  TimeOffRequest,
  TimeOffResult,
} from "./contract.ts"
import {
  asConflict,
  MS_PER_DAY,
  readDate,
  readDeadline,
  readEachInstance,
  readNumber,
  readRecords,
  selectInstances,
} from "./helpers.ts"

const LEAVE_LIST_LIMIT = 500

/* ------------------------------------------------------------------ */
/* Time off (hr_holidays)                                              */
/* ------------------------------------------------------------------ */

const LEAVE_UNITS: readonly LeaveUnit[] = ["day", "half_day", "hour"]
const LEAVE_FIELDS = [
  "id",
  ...LEAVE_SPAN_FIELDS,
  "name",
  "state",
  "number_of_days",
  "duration_display",
]
/** Requests shown: those ending in the last year, and every future one. */
const LEAVE_HISTORY_DAYS = 366
/** Public holidays shown: from a year ago to a year ahead. */
const HOLIDAY_SPAN_DAYS = 366

function readLeaveRequest(
  record: unknown,
  instanceIndex: InstanceIndex,
  today: string
): LeaveRequest | null {
  if (!isRecord(record) || !isPositiveInteger(record.id)) {
    return null
  }
  const type = readMany2one(record.holiday_status_id)
  const dateFrom = readDate(record.request_date_from)
  const dateTo = readDate(record.request_date_to)
  const state = LEAVE_STATES.find((value) => value === record.state)
  if (type === null || dateFrom === null || dateTo === null || !state) {
    return null
  }
  const isHours = record.request_unit_hours === true
  const fromPeriod = record.request_date_from_period
  // From Odoo 18, a half-day request may run from a morning to an
  // afternoon: only a single half day gets a period.
  const isSingleHalfDay =
    record.request_unit_half === true &&
    dateFrom === dateTo &&
    (record.request_date_to_period === undefined ||
      record.request_date_to_period === fromPeriod)
  const period =
    isSingleHalfDay && (fromPeriod === "am" || fromPeriod === "pm")
      ? fromPeriod
      : null
  // Odoo lets an employee change or delete a request only before it is
  // approved and before it starts.
  const isOpen =
    (state === "confirm" || state === "validate1") && dateFrom >= today
  return {
    instanceIndex,
    leaveId: record.id,
    leaveTypeId: type.id,
    leaveTypeName: type.name,
    dateFrom,
    dateTo,
    period,
    hourFrom: isHours ? readNumber(record.request_hour_from) : null,
    hourTo: isHours ? readNumber(record.request_hour_to) : null,
    days: readNumber(record.number_of_days) ?? 0,
    duration:
      typeof record.duration_display === "string"
        ? record.duration_display
        : null,
    description: typeof record.name === "string" ? record.name : "",
    state,
    canDelete: isOpen,
    canEdit: isOpen,
  }
}

/** Remaining days (or hours) per leave type, as Odoo's dashboard shows them. */
async function readLeaveBalances(
  session: OdooSession
): Promise<Map<number, Record<string, unknown>>> {
  const balances = new Map<number, Record<string, unknown>>()
  // get_allocation_data_request from Odoo 17, get_days_all_request before.
  for (const method of [
    "get_allocation_data_request",
    "get_days_all_request",
  ]) {
    let rows: unknown
    try {
      rows = await executeKw(session, "hr.leave.type", method, [])
    } catch (error) {
      if (error instanceof OdooRpcError) continue
      throw error
    }
    // Each row: [name, {remaining_leaves, max_leaves, ...}, requires_allocation, id]
    for (const row of Array.isArray(rows) ? rows : []) {
      if (Array.isArray(row) && isRecord(row[1]) && isPositiveInteger(row[3])) {
        balances.set(row[3], row[1])
      }
    }
    return balances
  }
  return balances
}

/** requires_allocation is a boolean from Odoo 18, "yes"/"no" before. */
function requiresAllocation(value: unknown): boolean {
  return value === true || value === "yes"
}

async function readLeaveTypes(
  session: OdooSession,
  instanceIndex: InstanceIndex
): Promise<LeaveType[]> {
  const available = await getModelFields(session, "hr.leave.type")
  const fields = [
    "id",
    "name",
    "requires_allocation",
    "request_unit",
    "has_valid_allocation",
    "time_type",
  ].filter((field) => available.has(field))
  const [records, balances] = await Promise.all([
    executeKw(session, "hr.leave.type", "search_read", [[]], {
      fields,
      order: available.has("sequence") ? "sequence, name" : "name",
    }),
    readLeaveBalances(session),
  ])
  return readRecords(records, session, "leave type").flatMap(
    (record): LeaveType[] => {
      if (
        !isRecord(record) ||
        !isPositiveInteger(record.id) ||
        typeof record.name !== "string"
      ) {
        return []
      }
      const needsAllocation = requiresAllocation(record.requires_allocation)
      // A type that needs an allocation can't be requested without one.
      if (needsAllocation && record.has_valid_allocation === false) {
        return []
      }
      const balance = balances.get(record.id)
      const unit =
        LEAVE_UNITS.find((value) => value === record.request_unit) ?? "day"
      return [
        {
          instanceIndex,
          leaveTypeId: record.id,
          name: record.name,
          unit,
          requiresAllocation: needsAllocation,
          workedTime: record.time_type === "other",
          remaining: needsAllocation
            ? readNumber(balance?.virtual_remaining_leaves)
            : null,
          allocated: needsAllocation ? readNumber(balance?.max_leaves) : null,
        },
      ]
    }
  )
}

/** Public holidays of the user's working schedule between the dates. */
async function readPublicHolidays(
  session: OdooSession,
  since: string,
  until: string
): Promise<PublicHoliday[]> {
  const records = await readPublicHolidayRecords(session, [
    ["date_from", "<=", `${until} 23:59:59`],
    ["date_to", ">=", `${since} 00:00:00`],
  ])
  return records.flatMap((record): PublicHoliday[] => {
    const from = readDeadline(record.date_from)
    const to = readDeadline(record.date_to)
    if (from === null || to === null) return []
    return [
      {
        name: typeof record.name === "string" ? record.name : "",
        from,
        to,
      },
    ]
  })
}

export function getTimeOff(
  instances: OdooInstanceSettings[],
  instanceIndex: InstanceIndex | null
): Promise<TimeOffResult[]> {
  return readEachInstance(
    instances,
    selectInstances(instances, instanceIndex),
    async (session, index) => {
      const leaveFields = await optionalModelFields(session, "hr.leave")
      if (leaveFields === null || (await readOwnEmployeeId(session)) === null) {
        return {
          available: false,
          leaveTypes: [],
          requests: [],
          holidays: [],
          truncated: false,
        }
      }
      const today = new Date().toISOString().slice(0, 10)
      const since = new Date(Date.now() - LEAVE_HISTORY_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10)
      const until = new Date(Date.now() + HOLIDAY_SPAN_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10)
      const [leaveTypes, records, holidays] = await Promise.all([
        readLeaveTypes(session, index),
        executeKw(
          session,
          "hr.leave",
          "search_read",
          [
            [
              ["user_id", "=", session.uid],
              ["request_date_to", ">=", since],
            ],
          ],
          {
            fields: LEAVE_FIELDS.filter((field) => leaveFields.has(field)),
            limit: LEAVE_LIST_LIMIT,
            order: "request_date_from desc, id desc",
          }
        ),
        readPublicHolidays(session, since, until),
      ])
      const raw = readRecords(records, session, "time off")
      return {
        available: true,
        leaveTypes,
        holidays,
        requests: raw.flatMap(
          (record) => readLeaveRequest(record, index, today) ?? []
        ),
        truncated: raw.length >= LEAVE_LIST_LIMIT,
      }
    }
  )
}

async function readOwnLeave(
  session: OdooSession,
  instanceIndex: InstanceIndex,
  leaveId: number
): Promise<LeaveRequest> {
  const leaveFields = await getModelFields(session, "hr.leave")
  const records = await executeKw(
    session,
    "hr.leave",
    "search_read",
    [
      [
        ["id", "=", leaveId],
        ["user_id", "=", session.uid],
      ],
    ],
    { fields: LEAVE_FIELDS.filter((field) => leaveFields.has(field)) }
  )
  const today = new Date().toISOString().slice(0, 10)
  const leave = readLeaveRequest(
    Array.isArray(records) ? records[0] : undefined,
    instanceIndex,
    today
  )
  if (leave === null) {
    throw new HttpError("This time off request can't be read in Odoo.", 404)
  }
  return leave
}

/** The hr.leave values of a request: its type, days, half day or hours. */
function timeOffValues(
  request: TimeOffRequest,
  leaveFields: Set<string>
): Record<string, unknown> {
  const { dateFrom } = request
  const values: Record<string, unknown> = {
    holiday_status_id: request.leaveTypeId,
    request_date_from: dateFrom,
    request_date_to: request.dateTo,
    name: request.description,
  }
  // Explicit, so an edit from half days or hours back to days clears them.
  for (const field of ["request_unit_half", "request_unit_hours"]) {
    if (leaveFields.has(field)) values[field] = false
  }
  if (request.period !== null) {
    values.request_unit_half = true
    values.request_date_from_period = request.period
    values.request_date_to = dateFrom
    if (leaveFields.has("request_date_to_period")) {
      values.request_date_to_period = request.period
    }
  } else if (request.hourFrom !== null && request.hourTo !== null) {
    values.request_unit_hours = true
    values.request_hour_from = request.hourFrom
    values.request_hour_to = request.hourTo
    values.request_date_to = dateFrom
  }
  return values
}

/**
 * Creates a time off request for the user's own employee; Odoo checks the
 * balance, overlaps and the type's unit.
 */
export async function requestTimeOff(
  instances: OdooInstanceSettings[],
  request: TimeOffRequest
): Promise<LeaveRequest> {
  const { instanceIndex } = request
  const session = await createSessionPool(instances)(instanceIndex)
  const [leaveFields, employeeId] = await Promise.all([
    getModelFields(session, "hr.leave"),
    readOwnEmployeeId(session),
  ])
  if (employeeId === null) {
    throw new HttpError(
      `Your user has no employee on ${session.connection.label}.`,
      409
    )
  }
  const values: Record<string, unknown> = {
    // Odoo only fills it in its own form: an API call must send it.
    employee_id: employeeId,
    ...timeOffValues(request, leaveFields),
  }
  const created = await asConflict(
    executeKw(session, "hr.leave", "create", [values])
  )
  const leaveId = Array.isArray(created) ? created[0] : created
  if (!isPositiveInteger(leaveId)) {
    throw new HttpError("Odoo didn't confirm the time off request.", 502)
  }
  return readOwnLeave(session, instanceIndex, leaveId)
}

/** Changes one of the user's requests that isn't approved nor started yet. */
export async function updateTimeOff(
  instances: OdooInstanceSettings[],
  request: TimeOffRequest & { leaveId: number }
): Promise<LeaveRequest> {
  const { instanceIndex, leaveId } = request
  const session = await createSessionPool(instances)(instanceIndex)
  const leave = await readOwnLeave(session, instanceIndex, leaveId)
  if (!leave.canEdit) {
    throw new HttpError(
      "Only requests waiting for approval and not started yet can be changed.",
      409
    )
  }
  const leaveFields = await getModelFields(session, "hr.leave")
  await asConflict(
    executeKw(session, "hr.leave", "write", [
      [leaveId],
      timeOffValues(request, leaveFields),
    ])
  )
  return readOwnLeave(session, instanceIndex, leaveId)
}

/** Deletes one of the user's requests that isn't approved yet. */
export async function deleteTimeOff(
  instances: OdooInstanceSettings[],
  { instanceIndex, leaveId }: LeaveReference
): Promise<LeaveReference> {
  const session = await createSessionPool(instances)(instanceIndex)
  const leave = await readOwnLeave(session, instanceIndex, leaveId)
  if (!leave.canDelete) {
    throw new HttpError(
      "Only requests waiting for approval and not started yet can be deleted.",
      409
    )
  }
  await asConflict(executeKw(session, "hr.leave", "unlink", [[leaveId]]))
  return { instanceIndex, leaveId }
}
