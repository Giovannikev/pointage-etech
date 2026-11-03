import type {
  OdooInstanceSettings,
  OdooInstanceUpdate,
  SettingsUpdate,
  SettingsView,
} from "@/types/settings"
import type { OdooInstanceIndex } from "@/types/timesheet"
import { ODOO_INSTANCE_INDEXES } from "@/utils/settings"

/** Editable state of one Odoo instance. Secrets start empty: they're write-only. */
export interface OdooInstanceDraft {
  label: string
  url: string
  db: string
  login: string
  apiKey: string
  hasStoredApiKey: boolean
}

export interface SettingsDraft {
  githubToken: string
  hasStoredGithubToken: boolean
  /** Comma or space separated. */
  authorEmails: string
  instances: Record<OdooInstanceIndex, OdooInstanceDraft>
}

function toInstanceDraft(
  instance: OdooInstanceSettings | undefined
): OdooInstanceDraft {
  return {
    label: instance?.label ?? "",
    url: instance?.url ?? "",
    db: instance?.db ?? "",
    login: instance?.login ?? "",
    apiKey: "",
    hasStoredApiKey: instance !== undefined,
  }
}

export function toSettingsDraft(settings: SettingsView): SettingsDraft {
  const findInstance = (index: OdooInstanceIndex) =>
    settings.odooInstances.find((instance) => instance.index === index)
  return {
    githubToken: "",
    hasStoredGithubToken: settings.github !== null,
    authorEmails: settings.github?.authorEmails.join(", ") ?? "",
    instances: {
      1: toInstanceDraft(findInstance(1)),
      2: toInstanceDraft(findInstance(2)),
    },
  }
}

/**
 * An instance is kept when something is filled in: either one alone is
 * enough (a user may work on Edoo IT only), but at least one is needed.
 */
export function isInstanceUsed(draft: OdooInstanceDraft): boolean {
  return [draft.label, draft.url, draft.db, draft.login, draft.apiKey].some(
    (value) => value.trim() !== ""
  )
}

/** An instance with nothing in it: "Remove" empties a configured one. */
export const EMPTY_INSTANCE: OdooInstanceDraft = {
  label: "",
  url: "",
  db: "",
  login: "",
  apiKey: "",
  hasStoredApiKey: false,
}

export function hasSomeInstance(draft: SettingsDraft): boolean {
  return ODOO_INSTANCE_INDEXES.some((index) =>
    isInstanceUsed(draft.instances[index])
  )
}

function toOptionalSecret(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function toInstanceUpdate(
  index: OdooInstanceIndex,
  draft: OdooInstanceDraft
): OdooInstanceUpdate {
  return {
    index,
    label: draft.label.trim(),
    url: draft.url.trim(),
    db: draft.db.trim(),
    login: draft.login.trim(),
    apiKey: toOptionalSecret(draft.apiKey),
  }
}

export function toSettingsUpdate(draft: SettingsDraft): SettingsUpdate {
  const token = toOptionalSecret(draft.githubToken)
  return {
    // No token typed and none kept: GitHub is off (or was disconnected).
    github:
      token === null && !draft.hasStoredGithubToken
        ? null
        : {
            token,
            authorEmails: draft.authorEmails
              .split(/[\s,;]+/)
              .filter((email) => email !== ""),
          },
    odooInstances: ODOO_INSTANCE_INDEXES.filter((index) =>
      isInstanceUsed(draft.instances[index])
    ).map((index) => toInstanceUpdate(index, draft.instances[index])),
  }
}
