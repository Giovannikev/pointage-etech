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

/** GitHub is optional: no token (or a removal) leaves it off. */
async function resolveGithub(
  stored: GithubSettings | null,
  update: SettingsUpdate["github"]
): Promise<GithubSettings | null> {
  if (update === null) {
    return null
  }
  const token = update.token ?? stored?.token
  if (token === undefined) {
    return null
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

/** True when the update targets another server, database or login. */
function changesConnection(
  stored: OdooInstanceSettings,
  update: OdooInstanceUpdate
): boolean {
  return (
    stored.url !== update.url ||
    stored.login !== update.login ||
    // An empty database means "detect it", which can't move to another server.
    (update.db !== "" && stored.db !== update.db)
  )
}

async function resolveOdooInstance(
  stored: OdooInstanceSettings | undefined,
  update: OdooInstanceUpdate
): Promise<OdooInstanceSettings> {
  // The stored key is reused only for the same server and account: otherwise
  // a stolen session could point the instance at its own server and receive
  // the key when the new connection is checked.
  const reusesKey = update.apiKey === null && stored !== undefined
  if (reusesKey && changesConnection(stored, update)) {
    throw new HttpError(
      `Enter the API key of ${update.label} again: its address, database or login changed.`,
      400
    )
  }
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
