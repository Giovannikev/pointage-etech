import { useTranslation } from "react-i18next"

import { AttendanceCard } from "@/components/leaves/AttendanceCard"
import { AutoAttendanceCard } from "@/components/leaves/AutoAttendanceCard"
import { LeavesCalendar } from "@/components/leaves/LeavesCalendar"
import { TimeOffCard } from "@/components/leaves/TimeOffCard"
import { SettingsGate } from "@/components/settings/SettingsGate"
import { SetupRequiredState } from "@/components/timesheet/SetupRequiredState"
import { useAutoAttendance } from "@/hooks/useAutoAttendance"

interface LeavesPageProps {
  onOpenSettings: () => void
}

/**
 * Time off requests and attendance, read from the Odoo instances that have
 * them, with the automatic attendance settings and a month calendar.
 */
export function LeavesPage({ onOpenSettings }: LeavesPageProps) {
  const { t } = useTranslation()
  const autoAttendance = useAutoAttendance()
  return (
    <main className="grid w-full min-w-0 grid-cols-1 content-start gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SettingsGate>
        {(settings) =>
          settings.odooInstances.length > 0 ? (
            <>
              <div className="grid gap-1">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {t("leaves.title")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("leaves.subtitle")}
                </p>
              </div>
              {/* Daily use first: attendance and its automation, time off. */}
              <div className="grid items-start gap-6 xl:grid-cols-2">
                <div className="grid min-w-0 gap-6">
                  <AttendanceCard schedule={autoAttendance.preferences} />
                  <AutoAttendanceCard state={autoAttendance} />
                </div>
                <TimeOffCard />
              </div>
              <LeavesCalendar />
            </>
          ) : (
            <SetupRequiredState onOpenSettings={onOpenSettings} />
          )
        }
      </SettingsGate>
    </main>
  )
}
