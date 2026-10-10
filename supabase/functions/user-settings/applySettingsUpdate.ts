import { HttpError } from "../_shared/errors.ts"
import { fetchViewer } from "../_shared/github.ts"
import { authenticate, detectDatabase } from "../_shared/odoo.ts"
import type {
  GithubSettings,
  OdooInstanceSettings,
  OdooInstanceUpdate,
  SettingsUpdate,
  UserSettings,
} from "../_shared/settings.ts"

async function resolveGithub(
  stored: GithubSettings | null,
  update: SettingsUpdate["github"]
): Promise<GithubSettings> {
  const token = update.token ?? stored?.token
  if (token === undefined) {
    throw new HttpError("Enter your GitHub token.", 400)
  }
  if (stored !== null && token === stored.token) {
    return { ...stored, authorEmails: update.authorEmails }
  }
  // A new token is checked against GitHub, which also tells whose it is.
  const viewer = await fetchViewer(token)
  return {
    token,
    login: viewer.login,
    nodeId: viewer.nodeId,
    authorEmails: update.authorEmails,
  }
}

function hasSameConnection(
  a: OdooInstanceSettings,
  b: OdooInstanceSettings
): boolean {
  return (
    a.url === b.url &&
    a.db === b.db &&
    a.login === b.login &&
    a.apiKey === b.apiKey
  )
}

async function resolveOdooInstance(
  stored: OdooInstanceSettings | undefined,
  update: OdooInstanceUpdate
): Promise<OdooInstanceSettings> {
  const apiKey = update.apiKey ?? stored?.apiKey
  if (apiKey === undefined) {
    throw new HttpError(`Enter the API key of ${update.label}.`, 400)
  }
  const db = update.db || (await detectDatabase(update.url, update.label))
  const instance: OdooInstanceSettings = { ...update, db, apiKey }

  // Only changed connections are checked, so a down instance doesn't block other edits.
  if (stored === undefined || !hasSameConnection(stored, instance)) {
    await authenticate(instance)
  }
  return instance
}

/**
 * Merges the update into the stored settings. Empty secrets keep the stored
 * ones; new or changed credentials are verified before being accepted.
 */
export async function applySettingsUpdate(
  current: UserSettings,
  update: SettingsUpdate
): Promise<UserSettings> {
  const [github, odooInstances] = await Promise.all([
    resolveGithub(current.github, update.github),
    Promise.all(
      update.odooInstances.map((instance) =>
        resolveOdooInstance(
          current.odooInstances.find(
            (stored) => stored.index === instance.index
          ),
          instance
        )
      )
    ),
  ])
  return {
    github,
    odooInstances: odooInstances.sort((a, b) => a.index - b.index),
  }
}
