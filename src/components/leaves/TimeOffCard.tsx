import { useCallback, useMemo, useState } from "react"
import {
  CalendarPlusIcon,
  HouseIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { TimeOffRequestDialog } from "@/components/leaves/TimeOffRequestDialog"
import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { InstanceErrorNotice } from "@/components/timesheet/InstanceErrorNotice"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCachedQuery } from "@/hooks/useCachedQuery"
import { useDialogTarget } from "@/hooks/useDialogTarget"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import {
  deleteTimeOff,
  fetchTimeOff,
  peekTimeOff,
} from "@/services/odooService"
import type {
  LeaveRequest,
  LeaveType,
  TimeOffInstanceResult,
} from "@/types/timesheet"
import { todayIsoDate } from "@/utils/date"
import {
  filterRequests,
  findRemoteWorkType,
  formatHourOfDay,
  holidayDates,
  leaveKey,
  leaveStateTone,
  nextWorkingDay,
  splitRequests,
} from "@/utils/leaves"

type AvailableTimeOff = Extract<TimeOffInstanceResult, { ok: true }>

type Tone = ReturnType<typeof leaveStateTone>
const TONES: readonly Tone[] = ["pending", "approved", "refused", "canceled"]

/** What the request dialog opens on: a new request, a preset one, or an edit. */
interface DialogState {
  editing: LeaveRequest | null
  preset: { type: LeaveType; date: string } | null
}

/** Past requests shown before "Show all": the list can hold a year. */
const PAST_PREVIEW = 3

const SELECT_CLASS =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

const TONE_STYLES = {
  pending: "bg-warning/12 text-warning",
  approved: "bg-success/12 text-success",
  refused: "bg-destructive/10 text-destructive",
  canceled: "bg-muted text-muted-foreground line-through",
} as const

function BalanceTile({
  type,
  showInstance,
}: {
  type: LeaveType
  showInstance: boolean
}) {
  const { t, i18n } = useTranslation()
  const { formatHours } = useFormatters()
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      maximumFractionDigits: 2,
    }).format(value)
  const remaining = type.remaining ?? 0
  return (
    <div className="grid gap-1 rounded-lg border p-3">
      <p className="truncate text-xs text-muted-foreground" title={type.name}>
        {type.name}
      </p>
      <p className="text-2xl font-semibold tabular-nums">
        {type.unit === "hour" ? formatHours(remaining) : number(remaining)}
      </p>
      <p className="text-xs text-muted-foreground">
        {type.unit === "hour"
          ? t("leaves.hoursLeft")
          : t("leaves.daysLeft", { count: remaining })}
        {type.allocated !== null &&
          ` · ${t("leaves.outOf", {
            total:
              type.unit === "hour"
                ? formatHours(type.allocated)
                : number(type.allocated),
          })}`}
      </p>
      {showInstance && <InstanceBadge instanceIndex={type.instanceIndex} />}
    </div>
  )
}

function RequestRow({
  request,
  showInstance,
  onEdit,
  onDelete,
}: {
  request: LeaveRequest
  showInstance: boolean
  onEdit: (request: LeaveRequest) => void
  onDelete: (request: LeaveRequest) => void
}) {
  const { t } = useTranslation()
  const { formatMediumDate, formatShortDate } = useFormatters()
  const tone = leaveStateTone(request.state)

  let when =
    request.dateFrom === request.dateTo
      ? formatMediumDate(request.dateFrom)
      : `${formatShortDate(request.dateFrom)} – ${formatMediumDate(request.dateTo)}`
  if (request.period !== null) {
    when += ` · ${request.period === "am" ? t("leaves.morning") : t("leaves.afternoon")}`
  }
  if (request.hourFrom !== null && request.hourTo !== null) {
    when += ` · ${formatHourOfDay(request.hourFrom)}–${formatHourOfDay(request.hourTo)}`
  }

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {request.leaveTypeName}
          </span>
          <Badge className={cn("font-semibold", TONE_STYLES[tone])}>
            {t(`leaves.state.${request.state}`)}
          </Badge>
          {showInstance && (
            <InstanceBadge instanceIndex={request.instanceIndex} />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {when}
          {request.duration !== null && ` · ${request.duration}`}
        </p>
        {request.description !== "" && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {request.description}
          </p>
        )}
      </div>
      {request.canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={t("leaves.edit")}
          title={t("leaves.edit")}
          onClick={() => onEdit(request)}
        >
          <PencilIcon />
        </Button>
      )}
      {request.canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={t("leaves.delete")}
          title={t("leaves.delete")}
          onClick={() => onDelete(request)}
        >
          <Trash2Icon />
        </Button>
      )}
    </li>
  )
}

function DeleteRequestDialog({
  request,
  open,
  onOpenChange,
  onDeleted,
}: {
  request: LeaveRequest | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: (request: LeaveRequest) => void
}) {
  const { t } = useTranslation()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (request === null) return
    setIsDeleting(true)
    setError(null)
    try {
      await deleteTimeOff({
        instanceIndex: request.instanceIndex,
        leaveId: request.leaveId,
      })
      onDeleted(request)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : String(deleteError)
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("leaves.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {request === null
              ? null
              : t("leaves.deleteDescription", {
                  type: request.leaveTypeName,
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isDeleting}
            onClick={() => void confirm()}
          >
            {isDeleting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
            {t("leaves.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Time off: balances, requests and their state, new requests. */
export function TimeOffCard() {
  const { t } = useTranslation()
  const fetcher = useCallback(
    ({ force }: { force: boolean }) => fetchTimeOff({ force }),
    []
  )
  const query = useCachedQuery("timeOff", fetcher, peekTimeOff)
  const { data, error, isLoading, isRefreshing, refresh } = query
  const { formatShortDate } = useFormatters()
  const requestDialog = useDialogTarget<DialogState>()
  const deleteDialog = useDialogTarget<LeaveRequest>()
  const [showAllPast, setShowAllPast] = useState(false)
  const [typeFilter, setTypeFilter] = useState("")
  const [toneFilter, setToneFilter] = useState<"" | Tone>("")

  const available = useMemo(
    () =>
      (data ?? []).filter(
        (result): result is AvailableTimeOff => result.ok && result.available
      ),
    [data]
  )
  // An instance with the app but nothing in it doesn't need naming.
  const showInstance =
    available.filter(
      (result) => result.leaveTypes.length > 0 || result.requests.length > 0
    ).length > 1
  const leaveTypes = available.flatMap((result) => result.leaveTypes)
  const balances = leaveTypes.filter((type) => type.requiresAllocation)
  // The instance of the latest request: where the user asks for time off.
  const defaultInstance =
    available
      .flatMap((result) => result.requests)
      .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))[0]?.instanceIndex ??
    null
  const allRequests = useMemo(
    () => available.flatMap((result) => result.requests),
    [available]
  )
  const typeNames = useMemo(
    () =>
      [...new Set(allRequests.map((request) => request.leaveTypeName))].sort(),
    [allRequests]
  )
  const { upcoming, past } = useMemo(
    () =>
      splitRequests(
        filterRequests(allRequests, typeFilter, toneFilter),
        todayIsoDate()
      ),
    [allRequests, typeFilter, toneFilter]
  )
  const holidays = useMemo(
    () => holidayDates(available.flatMap((result) => result.holidays)),
    [available]
  )
  const remoteType = findRemoteWorkType(leaveTypes)
  const remoteDay = nextWorkingDay(todayIsoDate(), holidays)
  const isFiltered = typeFilter !== "" || toneFilter !== ""

  const renderList = (
    title: string,
    requests: LeaveRequest[],
    limit = requests.length
  ) =>
    requests.length > 0 && (
      <section className="grid gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {title}
          {requests.length > limit && ` (${requests.length})`}
        </h3>
        <ul className="grid divide-y rounded-lg border">
          {requests.slice(0, limit).map((request) => (
            <RequestRow
              key={leaveKey(request)}
              request={request}
              showInstance={showInstance}
              onEdit={(editing) =>
                requestDialog.open({ editing, preset: null })
              }
              onDelete={deleteDialog.open}
            />
          ))}
        </ul>
      </section>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("leaves.timeOffTitle")}</CardTitle>
        <CardDescription>{t("leaves.timeOffSubtitle")}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("leaves.refresh")}
            disabled={isLoading || isRefreshing}
            onClick={refresh}
          >
            <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data?.map(
          (result) =>
            !result.ok && (
              <InstanceErrorNotice
                key={result.instanceIndex}
                instanceIndex={result.instanceIndex}
                message={result.error}
              />
            )
        )}
        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : data === undefined ? null : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("leaves.timeOffUnavailable")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                className="max-sm:w-full"
                disabled={leaveTypes.length === 0}
                onClick={() =>
                  requestDialog.open({ editing: null, preset: null })
                }
              >
                <CalendarPlusIcon />
                {t("leaves.newRequest")}
              </Button>
              {remoteType !== null && (
                <Button
                  variant="outline"
                  className="max-sm:w-full"
                  onClick={() =>
                    requestDialog.open({
                      editing: null,
                      preset: { type: remoteType, date: remoteDay },
                    })
                  }
                >
                  <HouseIcon />
                  {t("leaves.remoteTomorrow", {
                    day: formatShortDate(remoteDay),
                  })}
                </Button>
              )}
            </div>
            {balances.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {balances.map((type) => (
                  <BalanceTile
                    key={`${type.instanceIndex}:${type.leaveTypeId}`}
                    type={type}
                    showInstance={showInstance}
                  />
                ))}
              </div>
            )}
            {allRequests.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label={t("leaves.filterType")}
                  className={SELECT_CLASS}
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                >
                  <option value="">{t("leaves.allTypes")}</option>
                  {typeNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("leaves.filterState")}
                  className={SELECT_CLASS}
                  value={toneFilter}
                  onChange={(event) => {
                    const value = event.target.value
                    setToneFilter(TONES.find((tone) => tone === value) ?? "")
                  }}
                >
                  <option value="">{t("leaves.allStates")}</option>
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`leaves.tone.${tone}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {renderList(t("leaves.upcoming"), upcoming)}
            {renderList(
              t("leaves.past"),
              past,
              showAllPast ? past.length : PAST_PREVIEW
            )}
            {past.length > PAST_PREVIEW && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => setShowAllPast((shown) => !shown)}
              >
                {showAllPast
                  ? t("leaves.showLess")
                  : t("leaves.showAll", { count: past.length })}
              </Button>
            )}
            {upcoming.length === 0 && past.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {isFiltered ? t("leaves.noMatch") : t("leaves.noRequests")}
              </p>
            )}
          </>
        )}
      </CardContent>

      <TimeOffRequestDialog
        open={requestDialog.isOpen}
        leaveTypes={leaveTypes}
        showInstance={showInstance}
        defaultInstance={defaultInstance}
        holidays={holidays}
        editing={requestDialog.target?.editing ?? null}
        preset={requestDialog.target?.preset ?? null}
        onOpenChange={(open) => !open && requestDialog.close()}
        onSaved={(request) => {
          const wasEditing = requestDialog.target?.editing != null
          requestDialog.close()
          toast.success(
            wasEditing ? t("leaves.updated") : t("leaves.requestSent"),
            { description: request.leaveTypeName }
          )
          // Balances changed too: read them again.
          refresh()
        }}
      />
      <DeleteRequestDialog
        request={deleteDialog.target}
        open={deleteDialog.isOpen}
        onOpenChange={(open) => !open && deleteDialog.close()}
        onDeleted={(request) => {
          deleteDialog.close()
          toast.success(t("leaves.deleted"), {
            description: request.leaveTypeName,
          })
          refresh()
        }}
      />
    </Card>
  )
}
