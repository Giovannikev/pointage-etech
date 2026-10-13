import {
  ExternalLinkIcon,
  LifeBuoyIcon,
  StarIcon,
  TimerIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { InstanceBadge } from "@/components/timesheet/InstanceBadge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useOdooInstances } from "@/contexts/SettingsContext"
import { useFormatters } from "@/hooks/useFormatters"
import { cn } from "@/lib/utils"
import type { HelpdeskTicket, OdooInstanceIndex } from "@/types/timesheet"
import { getTicketUrl } from "@/utils/settings"

const INSTANCE_EDGES: Record<OdooInstanceIndex, string> = {
  1: "border-l-instance-1",
  2: "border-l-instance-2",
}

interface TicketCardProps {
  ticket: HelpdeskTicket
  showInstance: boolean
  onLogTime: (ticket: HelpdeskTicket) => void
}

/** A helpdesk ticket, styled like the Kanban task cards. */
export function TicketCard({
  ticket,
  showInstance,
  onLogTime,
}: TicketCardProps) {
  const { t } = useTranslation()
  const { formatHours } = useFormatters()
  const instances = useOdooInstances()
  const url = getTicketUrl(instances, ticket.instanceIndex, ticket.ticketId)

  const logButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={!ticket.loggable}
      onClick={() => onLogTime(ticket)}
    >
      <TimerIcon />
      {t("kanban.logTime")}
    </Button>
  )

  return (
    <article
      className={cn(
        "grid gap-2 rounded-lg border border-l-[3px] bg-card p-3 shadow-xs",
        INSTANCE_EDGES[ticket.instanceIndex]
      )}
      aria-label={ticket.name}
    >
      <div className="flex min-w-0 items-center gap-2">
        <LifeBuoyIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label={t("tasks.ticket")}
        />
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {ticket.ref ?? `#${ticket.ticketId}`}
        </span>
        {ticket.priority > 0 && (
          <StarIcon
            className="size-3.5 shrink-0 fill-warning text-warning"
            aria-label={t("kanban.starred")}
          />
        )}
        {ticket.stageName !== null && (
          <span className="truncate text-xs text-muted-foreground">
            {ticket.stageName}
          </span>
        )}
        {showInstance && (
          <span className="ml-auto min-w-0">
            <InstanceBadge instanceIndex={ticket.instanceIndex} />
          </span>
        )}
      </div>

      <p className="line-clamp-3 text-sm leading-snug font-medium">
        {ticket.name}
      </p>

      {(ticket.teamName ?? ticket.projectName) !== null && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={ticket.projectName ?? ticket.teamName ?? undefined}
        >
          {ticket.teamName ?? ticket.projectName}
        </p>
      )}

      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          {ticket.hoursSpent !== null && (
            <span className="tabular-nums">
              {t("kanban.hoursLogged", {
                hours: formatHours(ticket.hoursSpent),
              })}
            </span>
          )}
          {url !== null && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ExternalLinkIcon className="size-3.5" />
              {t("common.openInOdoo")}
            </a>
          )}
        </div>
        {ticket.loggable ? (
          logButton
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events: the span carries the tooltip. */}
              <span tabIndex={0} className="shrink-0 rounded-lg">
                {logButton}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t("tasks.ticketNotLoggable")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </article>
  )
}
