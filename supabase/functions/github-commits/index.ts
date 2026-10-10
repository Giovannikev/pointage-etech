/**
 * github-commits — Supabase Edge Function (Deno)
 *
 *   POST { since, until } (ISO timestamps)
 *   → { commits: [{ message, authoredAt }] }
 *
 * Reads the signed-in user's commits with the GitHub token stored in their
 * settings. The token never reaches the browser.
 */
import { HttpError } from "../_shared/errors.ts"
import { fetchCommits } from "../_shared/github.ts"
import { readJsonBody, serveJson } from "../_shared/http.ts"
import { requireGithub } from "../_shared/settings.ts"
import { loadSettings } from "../_shared/settingsStore.ts"
import { isIsoTimestamp, isRecord } from "../_shared/validation.ts"

/** Mirrors MAX_PERIOD_DAYS in src/utils/period.ts, plus a day of time zone margin. */
const MAX_PERIOD_DAYS = 366
const MAX_PERIOD_MS = (MAX_PERIOD_DAYS + 1) * 24 * 60 * 60 * 1000

function parsePeriod(body: unknown): { since: Date; until: Date } {
  if (
    !isRecord(body) ||
    !isIsoTimestamp(body.since) ||
    !isIsoTimestamp(body.until)
  ) {
    throw new HttpError('Send "since" and "until" as ISO timestamps.', 400)
  }
  const since = new Date(body.since)
  const until = new Date(body.until)
  if (since > until) {
    throw new HttpError("The period must start before it ends.", 400)
  }
  if (until.getTime() - since.getTime() > MAX_PERIOD_MS) {
    throw new HttpError(
      `The period can't be longer than ${MAX_PERIOD_DAYS} days.`,
      400
    )
  }
  return { since, until }
}

serveJson("github-commits", {
  POST: async ({ request, userId }) => {
    const period = parsePeriod(await readJsonBody(request))
    const github = requireGithub(await loadSettings(userId))
    const commits = await fetchCommits(github.token, {
      ...period,
      authorNodeId: github.nodeId,
      authorEmails: github.authorEmails,
    })
    return { commits }
  },
})
