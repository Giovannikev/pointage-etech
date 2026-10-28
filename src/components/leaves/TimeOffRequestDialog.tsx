import { useId, useMemo, useState, type FormEvent } from "react"
import { CalendarPlusIcon, Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { DatePicker } from "@/components/timesheet/DatePicker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useInstanceLabel } from "@/contexts/SettingsContext"
import { useFormatters } from "@/hooks/useFormatters"
import { requestTimeOff } from "@/services/odooService"
import type {
  HalfDayPeriod,
  LeaveRequest,
  LeaveType,
  LeaveUnit,
  OdooInstanceIndex,
} from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import { parseHourOfDay } from "@/utils/leaves"

type RequestMode = "days" | "half" | "hours"

const INSTANCE_ORDER: readonly OdooInstanceIndex[] = [1, 2]

/** What a type lets the user request, as Odoo's own form offers it. */
const MODES_BY_UNIT: Record<LeaveUnit, RequestMode[]> = {
  day: ["days"],
  half_day: ["days", "half"],
  hour: ["days", "half", "hours"],
}

interface TimeOffRequestDialogProps {
  open: boolean
  leaveTypes: LeaveType[]
  /** Several instances have Time Off: each type names its instance. */
  showInstance: boolean
  /** Instance whose first type is preselected: where the user requests time off. */
  defaultInstance: OdooInstanceIndex | null
  onOpenChange: (open: boolean) => void
  onCreated: (request: LeaveRequest) => void
}

function typeKey(type: LeaveType): string {
  return `${type.instanceIndex}:${type.leaveTypeId}`
}

function TypeOption({ type }: { type: LeaveType }) {
  const { t, i18n } = useTranslation()
  const { formatHours } = useFormatters()
  const balance =
    type.remaining === null
      ? ""
      : type.unit === "hour"
        ? ` — ${t("leaves.remainingHours", { hours: formatHours(type.remaining) })}`
        : ` — ${t("leaves.remainingDays", {
            count: type.remaining,
            days: new Intl.NumberFormat(i18n.resolvedLanguage, {
              maximumFractionDigits: 2,
            }).format(type.remaining),
          })}`
  return (
    <option value={typeKey(type)}>
      {type.name}
      {balance}
    </option>
  )
}

/** The types of one instance, under its name when several are listed. */
function InstanceTypes({
  instanceIndex,
  types,
  showInstance,
}: {
  instanceIndex: OdooInstanceIndex
  types: LeaveType[]
  showInstance: boolean
}) {
  const label = useInstanceLabel(instanceIndex)
  const options = types.map((type) => (
    <TypeOption key={typeKey(type)} type={type} />
  ))
  return showInstance ? <optgroup label={label}>{options}</optgroup> : options
}

function RequestForm({
  leaveTypes,
  showInstance,
  defaultInstance,
  onCreated,
}: Omit<TimeOffRequestDialogProps, "open" | "onOpenChange">) {
  const { t } = useTranslation()
  const fieldId = useId()
  const [selectedKey, setSelectedKey] = useState(() => {
    const first =
      leaveTypes.find((type) => type.instanceIndex === defaultInstance) ??
      leaveTypes[0]
    return first === undefined ? "" : typeKey(first)
  })
  const [mode, setMode] = useState<RequestMode>("days")
  const [dateFrom, setDateFrom] = useState(todayIsoDate)
  const [dateTo, setDateTo] = useState(todayIsoDate)
  const [period, setPeriod] = useState<HalfDayPeriod>("am")
  const [hourFrom, setHourFrom] = useState("08:00")
  const [hourTo, setHourTo] = useState("10:00")
  const [description, setDescription] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const type = useMemo(
    () => leaveTypes.find((candidate) => typeKey(candidate) === selectedKey),
    [leaveTypes, selectedKey]
  )
  const modes: RequestMode[] =
    type === undefined ? ["days"] : MODES_BY_UNIT[type.unit]
  // A mode the newly picked type doesn't offer falls back to whole days.
  const activeMode: RequestMode = modes.includes(mode) ? mode : "days"

  const parsedFrom = parseHourOfDay(hourFrom)
  const parsedTo = parseHourOfDay(hourTo)
  const hoursValid =
    parsedFrom !== null && parsedTo !== null && parsedTo > parsedFrom
  const datesValid = activeMode !== "days" || dateTo >= dateFrom
  const canSend =
    type !== undefined &&
    datesValid &&
    (activeMode !== "hours" || hoursValid) &&
    !isSending

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSend || type === undefined) {
      return
    }
    setIsSending(true)
    setError(null)
    try {
      const created = await requestTimeOff({
        instanceIndex: type.instanceIndex,
        leaveTypeId: type.leaveTypeId,
        dateFrom,
        dateTo: activeMode === "days" ? dateTo : dateFrom,
        period: activeMode === "half" ? period : null,
        hourFrom: activeMode === "hours" ? parsedFrom : null,
        hourTo: activeMode === "hours" ? parsedTo : null,
        description: description.trim(),
      })
      onCreated(created)
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : String(sendError)
      )
      setIsSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("leaves.newRequest")}</DialogTitle>
        <DialogDescription>{t("leaves.newRequestHint")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-type`}>{t("leaves.type")}</Label>
        <select
          id={`${fieldId}-type`}
          value={selectedKey}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          onChange={(event) => setSelectedKey(event.target.value)}
        >
          {INSTANCE_ORDER.map((index) => {
            const types = leaveTypes.filter(
              (type) => type.instanceIndex === index
            )
            return (
              types.length > 0 && (
                <InstanceTypes
                  key={index}
                  instanceIndex={index}
                  types={types}
                  showInstance={showInstance}
                />
              )
            )
          })}
        </select>
      </div>

      {modes.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label={t("leaves.duration")}
          value={activeMode}
          onValueChange={(value) => {
            if (value === "days" || value === "half" || value === "hours") {
              setMode(value)
            }
          }}
        >
          {modes.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {t(`leaves.mode.${option}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {activeMode === "days" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-from`}>{t("leaves.from")}</Label>
            <DatePicker
              id={`${fieldId}-from`}
              value={dateFrom}
              onChange={(value) => {
                setDateFrom(value)
                if (dateTo < value) setDateTo(value)
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-to`}>{t("leaves.to")}</Label>
            <DatePicker
              id={`${fieldId}-to`}
              value={dateTo}
              onChange={setDateTo}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-day`}>{t("leaves.day")}</Label>
          <DatePicker
            id={`${fieldId}-day`}
            value={dateFrom}
            onChange={setDateFrom}
          />
        </div>
      )}

      {activeMode === "half" && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label={t("leaves.halfDay")}
          value={period}
          onValueChange={(value) => {
            if (value === "am" || value === "pm") setPeriod(value)
          }}
        >
          <ToggleGroupItem value="am">{t("leaves.morning")}</ToggleGroupItem>
          <ToggleGroupItem value="pm">{t("leaves.afternoon")}</ToggleGroupItem>
        </ToggleGroup>
      )}

      {activeMode === "hours" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-hour-from`}>
              {t("leaves.hourFrom")}
            </Label>
            <Input
              id={`${fieldId}-hour-from`}
              type="time"
              value={hourFrom}
              aria-invalid={!hoursValid}
              onChange={(event) => setHourFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-hour-to`}>{t("leaves.hourTo")}</Label>
            <Input
              id={`${fieldId}-hour-to`}
              type="time"
              value={hourTo}
              aria-invalid={!hoursValid}
              onChange={(event) => setHourTo(event.target.value)}
            />
          </div>
        </div>
      )}

      {!datesValid && (
        <p className="text-sm text-destructive" role="alert">
          {t("leaves.datesOrder")}
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-description`}>
          {t("leaves.description")}
        </Label>
        <Textarea
          id={`${fieldId}-description`}
          value={description}
          placeholder={t("leaves.descriptionPlaceholder")}
          className="min-h-20"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isSending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSend}>
          {isSending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <CalendarPlusIcon />
          )}
          {t("leaves.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Sends a time off request to Odoo, which checks the balance and overlaps. */
export function TimeOffRequestDialog({
  open,
  leaveTypes,
  showInstance,
  defaultInstance,
  onOpenChange,
  onCreated,
}: TimeOffRequestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {open && (
          <RequestForm
            leaveTypes={leaveTypes}
            showInstance={showInstance}
            defaultInstance={defaultInstance}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
