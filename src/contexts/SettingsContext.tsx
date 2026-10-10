import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { fetchSettings, saveSettings } from "@/services/settingsService"
import type {
  OdooInstanceSettings,
  SettingsUpdate,
  SettingsView,
} from "@/types/settings"
import type { OdooInstanceIndex } from "@/types/timesheet"
import { getInstanceLabel } from "@/utils/settings"

type SettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: SettingsView }

interface SettingsContextValue {
  state: SettingsState
  reload: () => void
  /** Verifies and stores the settings; rejects with the server's message. */
  save: (update: SettingsUpdate) => Promise<SettingsView>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
)

const NO_INSTANCES: OdooInstanceSettings[] = []

/** Loads the signed-in user's settings once and shares them with the app. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>({ status: "loading" })

  const load = useCallback((): void => {
    fetchSettings().then(
      (settings) => setState({ status: "ready", settings }),
      (error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        })
    )
  }, [])

  useEffect(load, [load])

  const reload = useCallback((): void => {
    setState({ status: "loading" })
    load()
  }, [load])

  const save = useCallback(
    async (update: SettingsUpdate): Promise<SettingsView> => {
      const settings = await saveSettings(update)
      setState({ status: "ready", settings })
      return settings
    },
    []
  )

  const value = useMemo(() => ({ state, reload, save }), [state, reload, save])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider")
  }
  return context
}

/** Configured Odoo instances, empty until the settings are loaded. */
export function useOdooInstances(): OdooInstanceSettings[] {
  const { state } = useSettings()
  return state.status === "ready" ? state.settings.odooInstances : NO_INSTANCES
}

export function useInstanceLabel(index: OdooInstanceIndex): string {
  return getInstanceLabel(useOdooInstances(), index)
}
