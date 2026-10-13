import { HttpError } from "./errors.ts"
import { isNonEmptyString, isRecord } from "./validation.ts"

export type InstanceIndex = 1 | 2

export const INSTANCE_INDEXES: readonly InstanceIndex[] = [1, 2]

const MAX_LABEL_LENGTH = 60
const MAX_FIELD_LENGTH = 255
const MAX_DB_LENGTH = 63
const MAX_AUTHOR_EMAILS = 10

/* ------------------------------------------------------------------ */
/* Stored model (encrypted at rest)                                    */
/* ------------------------------------------------------------------ */

export interface GithubSettings {
  token: string
  login: string
  /** GraphQL node id of the GitHub user, used to filter commits by author. */
  nodeId: string
  /** Commit emails not linked to the GitHub account. */
  authorEmails: string[]
}

export interface OdooInstanceSettings {
  index: InstanceIndex
  label: string
  url: string
  db: string
  login: string
  apiKey: string
}

export interface UserSettings {
  github: GithubSettings | null
  odooInstances: OdooInstanceSettings[]
}

export const EMPTY_SETTINGS: UserSettings = { github: null, odooInstances: [] }

/* ------------------------------------------------------------------ */
/* user-settings contract — mirrors src/types/settings.ts              */
/* Secrets are write-only: they never travel back to the browser.      */
/* ------------------------------------------------------------------ */

type OdooInstanceView = Omit<OdooInstanceSettings, "apiKey">

export interface SettingsView {
  github: { login: string; authorEmails: string[] } | null
  odooInstances: OdooInstanceView[]
}

export interface OdooInstanceUpdate extends OdooInstanceView {
  /** null keeps the stored API key. */
  apiKey: string | null
}

export interface SettingsUpdate {
  github: {
    /** null keeps the stored token. */
    token: string | null
    authorEmails: string[]
  }
  odooInstances: OdooInstanceUpdate[]
}

export function toSettingsView(settings: UserSettings): SettingsView {
  return {
    github:
      settings.github === null
        ? null
        : {
            login: settings.github.login,
            authorEmails: settings.github.authorEmails,
          },
    odooInstances: settings.odooInstances.map(
      ({ index, label, url, db, login }) => ({ index, label, url, db, login })
    ),
  }
}

export function requireGithub(settings: UserSettings): GithubSettings {
  if (settings.github === null) {
    throw new HttpError("Add your GitHub token in Settings first.", 400)
  }
  return settings.github
}

export function requireOdooInstances(
  settings: UserSettings
): OdooInstanceSettings[] {
  if (settings.odooInstances.length === 0) {
    throw new HttpError("Add an Odoo instance in Settings first.", 400)
  }
  return settings.odooInstances
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function isInstanceIndex(value: unknown): value is InstanceIndex {
  return value === 1 || value === 2
}

function isOptionalSecret(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value, MAX_FIELD_LENGTH)
}

function isEmailList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_AUTHOR_EMAILS &&
    value.every(
      (email) =>
        isNonEmptyString(email, MAX_FIELD_LENGTH) && email.includes("@")
    )
  )
}

/** Keeps only the origin, so a pasted page URL (".../odoo/action-224") still works. */
function normalizeOdooUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null
  } catch {
    return null
  }
}

function parseInstanceFields(value: unknown): OdooInstanceView | null {
  if (!isRecord(value)) {
    return null
  }
  const url = normalizeOdooUrl(value.url)
  if (
    !isInstanceIndex(value.index) ||
    !isNonEmptyString(value.label, MAX_LABEL_LENGTH) ||
    url === null ||
    typeof value.db !== "string" ||
    value.db.length > MAX_DB_LENGTH ||
    !isNonEmptyString(value.login, MAX_FIELD_LENGTH)
  ) {
    return null
  }
  return {
    index: value.index,
    label: value.label.trim(),
    url,
    db: value.db.trim(),
    login: value.login.trim(),
  }
}

function hasUniqueIndexes(instances: { index: InstanceIndex }[]): boolean {
  return (
    new Set(instances.map((instance) => instance.index)).size ===
    instances.length
  )
}

export function parseSettingsUpdate(body: unknown): SettingsUpdate {
  if (!isRecord(body) || !isRecord(body.github)) {
    throw new HttpError("Request body must contain the GitHub settings.", 400)
  }
  const { token, authorEmails } = body.github
  if (!isOptionalSecret(token)) {
    throw new HttpError("The GitHub token is invalid.", 400)
  }
  if (!isEmailList(authorEmails)) {
    throw new HttpError(
      `Commit emails must be at most ${MAX_AUTHOR_EMAILS} valid addresses.`,
      400
    )
  }

  const rawInstances = body.odooInstances
  if (
    !Array.isArray(rawInstances) ||
    rawInstances.length === 0 ||
    rawInstances.length > INSTANCE_INDEXES.length
  ) {
    throw new HttpError(
      `Configure between 1 and ${INSTANCE_INDEXES.length} Odoo instances.`,
      400
    )
  }
  const odooInstances = rawInstances.map((raw, position) => {
    const fields = parseInstanceFields(raw)
    if (fields === null || !isRecord(raw) || !isOptionalSecret(raw.apiKey)) {
      throw new HttpError(`Odoo instance ${position + 1} is invalid.`, 400)
    }
    return { ...fields, apiKey: raw.apiKey === null ? null : raw.apiKey.trim() }
  })
  if (!hasUniqueIndexes(odooInstances)) {
    throw new HttpError("Each Odoo instance must be configured once.", 400)
  }

  return {
    github: {
      token: token === null ? null : token.trim(),
      authorEmails: authorEmails.map((email) => email.trim()),
    },
    odooInstances,
  }
}

/** Validates the decrypted settings document. */
export function parseStoredSettings(value: unknown): UserSettings {
  const invalid = new HttpError(
    "Your stored settings are invalid. Save them again.",
    500
  )
  if (!isRecord(value) || !Array.isArray(value.odooInstances)) {
    throw invalid
  }

  let github: GithubSettings | null = null
  if (value.github !== null) {
    const stored = value.github
    if (
      !isRecord(stored) ||
      !isNonEmptyString(stored.token, MAX_FIELD_LENGTH) ||
      !isNonEmptyString(stored.login, MAX_FIELD_LENGTH) ||
      !isNonEmptyString(stored.nodeId, MAX_FIELD_LENGTH) ||
      !isEmailList(stored.authorEmails)
    ) {
      throw invalid
    }
    github = {
      token: stored.token,
      login: stored.login,
      nodeId: stored.nodeId,
      authorEmails: stored.authorEmails,
    }
  }

  const odooInstances = value.odooInstances.map((stored) => {
    const fields = parseInstanceFields(stored)
    if (
      fields === null ||
      !isRecord(stored) ||
      !isNonEmptyString(stored.apiKey, MAX_FIELD_LENGTH)
    ) {
      throw invalid
    }
    return { ...fields, apiKey: stored.apiKey }
  })
  if (!hasUniqueIndexes(odooInstances)) {
    throw invalid
  }

  return { github, odooInstances }
}
