import {
  InvalidResponseError,
  invokeFunction,
} from "@/services/edgeFunctionClient"
import type {
  GithubSettings,
  OdooInstanceSettings,
  SettingsUpdate,
  SettingsView,
} from "@/types/settings"
import { isRecord } from "@/utils/guards"

const SETTINGS_FUNCTION = "user-settings"

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function toGithubSettings(value: unknown): GithubSettings | null {
  if (value === null) {
    return null
  }
  if (
    isRecord(value) &&
    typeof value.login === "string" &&
    isStringList(value.authorEmails)
  ) {
    return { login: value.login, authorEmails: value.authorEmails }
  }
  throw new InvalidResponseError(SETTINGS_FUNCTION)
}

function toOdooInstance(value: unknown): OdooInstanceSettings {
  if (
    isRecord(value) &&
    (value.index === 1 || value.index === 2) &&
    typeof value.label === "string" &&
    typeof value.url === "string" &&
    typeof value.db === "string" &&
    typeof value.login === "string"
  ) {
    return {
      index: value.index,
      label: value.label,
      url: value.url,
      db: value.db,
      login: value.login,
    }
  }
  throw new InvalidResponseError(SETTINGS_FUNCTION)
}

function toSettingsView(data: unknown): SettingsView {
  if (!isRecord(data) || !Array.isArray(data.odooInstances)) {
    throw new InvalidResponseError(SETTINGS_FUNCTION)
  }
  return {
    github: toGithubSettings(data.github),
    odooInstances: data.odooInstances.map(toOdooInstance),
  }
}

export async function fetchSettings(): Promise<SettingsView> {
  return toSettingsView(
    await invokeFunction(SETTINGS_FUNCTION, { method: "GET" })
  )
}

/** Verifies the new credentials server-side, then stores them encrypted. */
export async function saveSettings(
  update: SettingsUpdate
): Promise<SettingsView> {
  return toSettingsView(
    await invokeFunction(SETTINGS_FUNCTION, { method: "PUT", body: update })
  )
}
