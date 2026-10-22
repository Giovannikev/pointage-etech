/** Written at each build by scripts/write-version.mjs. */
export const VERSION_URL = "/version.json"

/** The version in the content of version.json; null when it isn't one. */
export function readVersionFile(content: unknown): string | null {
  if (
    typeof content === "object" &&
    content !== null &&
    "version" in content &&
    typeof content.version === "string" &&
    content.version.trim() !== ""
  ) {
    return content.version.trim()
  }
  return null
}

/**
 * The version currently deployed, read past every cache. null when it can't
 * be told (offline, missing file, the host answering with an HTML page):
 * a failed check must never announce an update.
 */
export async function fetchDeployedVersion(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${VERSION_URL}?t=${now()}`, {
      cache: "no-store",
    })
    if (!response.ok) {
      return null
    }
    return readVersionFile(await response.json())
  } catch {
    return null
  }
}

/** True when another deployment than the running bundle's is online. */
export function isNewDeployment(
  running: string | null,
  deployed: string | null
): boolean {
  return running !== null && deployed !== null && deployed !== running
}
