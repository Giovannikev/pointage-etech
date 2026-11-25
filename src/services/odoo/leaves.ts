import {
  cacheKey,
  odooCache,
  type CacheKey,
  type CacheReadOptions,
} from "@/lib/odooCache"
import { InvalidResponseError } from "@/services/edgeFunctionClient"
import {
  GATEWAY_FUNCTION,
  invokeGateway,
  isInstanceIndex,
  isNullableNumber,
  isNullableString,
  readInstanceResults,
  readList,
  toInstanceResult,
} from "@/services/odoo/shared"
import type {
  LeaveReference,
  LeaveRequest,
  LeaveType,
  PublicHoliday,
  TimeOffInstanceResult,
  TimeOffSubmission,
} from "@/types/timesheet"
import { isPositiveInteger, isRecord } from "@/utils/guards"

/* ------------------------------------------------------------------ */
/* Time off                                                            */
/* ------------------------------------------------------------------ */

const TIME_OFF_KEY: CacheKey<TimeOffInstanceResult[]> = cacheKey("timeOff")
const TIME_OFF_TTL_MS = 2 * 60_000

const LEAVE_STATES = ["confirm", "refuse", "validate1", "validate", "cancel"]
const LEAVE_UNITS = ["day", "half_day", "hour"]

function isHalfDayPeriod(value: unknown): value is "am" | "pm" | null {
  return value === null || value === "am" || value === "pm"
}

function toLeaveType(value: unknown): LeaveType {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.leaveTypeId) &&
    typeof value.name === "string" &&
    typeof value.unit === "string" &&
    LEAVE_UNITS.includes(value.unit) &&
    isNullableNumber(value.remaining) &&
    isNullableNumber(value.allocated)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      leaveTypeId: value.leaveTypeId,
      name: value.name,
      unit: value.unit as LeaveType["unit"],
      requiresAllocation: value.requiresAllocation === true,
      workedTime: value.workedTime === true,
      remaining: value.remaining,
      allocated: value.allocated,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toLeaveRequest(value: unknown): LeaveRequest {
  if (
    isRecord(value) &&
    isInstanceIndex(value.instanceIndex) &&
    isPositiveInteger(value.leaveId) &&
    isPositiveInteger(value.leaveTypeId) &&
    typeof value.leaveTypeName === "string" &&
    typeof value.dateFrom === "string" &&
    typeof value.dateTo === "string" &&
    isHalfDayPeriod(value.period) &&
    isNullableNumber(value.hourFrom) &&
    isNullableNumber(value.hourTo) &&
    typeof value.days === "number" &&
    isNullableString(value.duration) &&
    typeof value.description === "string" &&
    typeof value.state === "string" &&
    LEAVE_STATES.includes(value.state)
  ) {
    return {
      instanceIndex: value.instanceIndex,
      leaveId: value.leaveId,
      leaveTypeId: value.leaveTypeId,
      leaveTypeName: value.leaveTypeName,
      dateFrom: value.dateFrom,
      dateTo: value.dateTo,
      period: value.period,
      hourFrom: value.hourFrom,
      hourTo: value.hourTo,
      days: value.days,
      duration: value.duration,
      description: value.description,
      state: value.state as LeaveRequest["state"],
      canDelete: value.canDelete === true,
      canEdit: value.canEdit === true,
    }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

function toPublicHoliday(value: unknown): PublicHoliday {
  if (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string"
  ) {
    return { name: value.name, from: value.from, to: value.to }
  }
  throw new InvalidResponseError(GATEWAY_FUNCTION)
}

/** Leave types with their balance, and the user's requests, per instance. */
export function fetchTimeOff(
  options: CacheReadOptions = {}
): Promise<TimeOffInstanceResult[]> {
  return odooCache.getOrFetch(
    TIME_OFF_KEY,
    TIME_OFF_TTL_MS,
    async () =>
      readInstanceResults(await invokeGateway({ action: "GET_TIME_OFF" })).map(
        (value) =>
          toInstanceResult(value, (record) => ({
            available: record.available === true,
            leaveTypes: readList(record.leaveTypes, toLeaveType),
            requests: readList(record.requests, toLeaveRequest),
            // Absent from a gateway deployed before holidays were read.
            holidays:
              record.holidays === undefined
                ? []
                : readList(record.holidays, toPublicHoliday),
            truncated: record.truncated === true,
          }))
      ),
    options
  )
}

export function peekTimeOff(): TimeOffInstanceResult[] | undefined {
  return odooCache.peek(TIME_OFF_KEY)
}

/** Sends a time off request to Odoo; resolves with the request as stored. */
export async function requestTimeOff(
  submission: TimeOffSubmission
): Promise<LeaveRequest> {
  try {
    const data = await invokeGateway({
      action: "REQUEST_TIME_OFF",
      ...submission,
    })
    if (isRecord(data)) {
      return toLeaveRequest(data.request)
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    // Balances changed too.
    odooCache.invalidate(TIME_OFF_KEY.id)
  }
}

/** Changes a request still waiting for approval; resolves with it as stored. */
export async function updateTimeOff(
  leaveId: number,
  submission: TimeOffSubmission
): Promise<LeaveRequest> {
  try {
    const data = await invokeGateway({
      action: "UPDATE_TIME_OFF",
      leaveId,
      ...submission,
    })
    if (isRecord(data)) {
      return toLeaveRequest(data.request)
    }
    throw new InvalidResponseError(GATEWAY_FUNCTION)
  } finally {
    odooCache.invalidate(TIME_OFF_KEY.id)
  }
}

/** Deletes a request still waiting for approval. */
export async function deleteTimeOff(reference: LeaveReference): Promise<void> {
  try {
    await invokeGateway({ action: "DELETE_TIME_OFF", ...reference })
  } finally {
    odooCache.invalidate(TIME_OFF_KEY.id)
  }
}
