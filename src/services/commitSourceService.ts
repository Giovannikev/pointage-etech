import {
  InvalidResponseError,
  invokeFunction,
} from "@/services/edgeFunctionClient"
import type {
  CommitPeriod,
  FetchCommitsRequest,
  GithubCommit,
  RawCommit,
} from "@/types/timesheet"
import { endOfDay, startOfDay, toIsoDate } from "@/utils/date"
import { isRecord } from "@/utils/guards"

const COMMITS_FUNCTION = "github-commits"

function toGithubCommit(value: unknown): GithubCommit {
  if (
    isRecord(value) &&
    typeof value.message === "string" &&
    typeof value.authoredAt === "string" &&
    !Number.isNaN(Date.parse(value.authoredAt))
  ) {
    return { message: value.message, authoredAt: value.authoredAt }
  }
  throw new InvalidResponseError(COMMITS_FUNCTION)
}

/**
 * Fetches the signed-in user's GitHub commits authored during the period,
 * with each commit dated on the browser's local day.
 */
export async function fetchCommits(period: CommitPeriod): Promise<RawCommit[]> {
  const request: FetchCommitsRequest = {
    since: startOfDay(period.from).toISOString(),
    until: endOfDay(period.to).toISOString(),
  }
  const data = await invokeFunction(COMMITS_FUNCTION, { body: request })
  if (!isRecord(data) || !Array.isArray(data.commits)) {
    throw new InvalidResponseError(COMMITS_FUNCTION)
  }
  return data.commits.map(toGithubCommit).map(({ message, authoredAt }) => ({
    message,
    date: toIsoDate(new Date(authoredAt)),
  }))
}
