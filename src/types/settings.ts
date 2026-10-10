import type { OdooInstanceIndex } from "@/types/timesheet"

/* ------------------------------------------------------------------ */
/* user-settings Edge Function contract                                */
/* Mirrored in supabase/functions/_shared/settings.ts                  */
/* Secrets are write-only: the browser never receives them back.       */
/* ------------------------------------------------------------------ */

export interface OdooInstanceSettings {
  index: OdooInstanceIndex
  label: string
  url: string
  db: string
  login: string
}

export interface GithubSettings {
  login: string
  /** Commit emails not linked to the GitHub account. */
  authorEmails: string[]
}

export interface SettingsView {
  github: GithubSettings | null
  odooInstances: OdooInstanceSettings[]
}

export interface OdooInstanceUpdate extends OdooInstanceSettings {
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
