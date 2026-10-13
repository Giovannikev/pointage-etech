/**
 * Small in-memory cache for Odoo reads.
 *
 * - Values expire after a time to live (TTL).
 * - Concurrent reads of the same key share one request.
 * - A request started before an invalidation never writes its (stale) result.
 *
 * It lives as long as the page: a reload starts empty, which is what we want
 * for data that other people can change in Odoo.
 */

/** Typed key: the phantom `value` type ties a key to what it stores. */
export interface CacheKey<T> {
  readonly id: string
  /** Never set: only carries the value type for the compiler. */
  readonly value?: T
}

export function cacheKey<T>(id: string): CacheKey<T> {
  return { id }
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

interface InflightRequest {
  promise: Promise<unknown>
  generation: number
}

export interface CacheReadOptions {
  /** Skips the stored value and fetches again. */
  force?: boolean
}

export class OdooCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, InflightRequest>()
  /** Bumped by every invalidation, so older requests don't store their result. */
  private generation = 0
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** The stored value if it is still fresh. Read-only, so safe during a render. */
  peek<T>(key: CacheKey<T>): T | undefined {
    const entry = this.entries.get(key.id)
    if (entry === undefined || entry.expiresAt <= this.now()) {
      return undefined
    }
    // The key's type guarantees what was stored under it (see set).
    return entry.value as T
  }

  set<T>(key: CacheKey<T>, value: T, ttlMs: number): void {
    this.entries.set(key.id, { value, expiresAt: this.now() + ttlMs })
  }

  /** Returns the fresh value, or fetches it once for every concurrent caller. */
  async getOrFetch<T>(
    key: CacheKey<T>,
    ttlMs: number,
    fetcher: () => Promise<T>,
    { force = false }: CacheReadOptions = {}
  ): Promise<T> {
    if (!force) {
      const cached = this.peek(key)
      if (cached !== undefined) {
        return cached
      }
      const pending = this.inflight.get(key.id)
      if (pending !== undefined && pending.generation === this.generation) {
        return pending.promise as Promise<T>
      }
    }

    const generation = this.generation
    const promise = fetcher().then((value) => {
      if (generation === this.generation) {
        this.set(key, value, ttlMs)
      }
      return value
    })
    const request: InflightRequest = { promise, generation }
    this.inflight.set(key.id, request)
    const release = (): void => {
      if (this.inflight.get(key.id) === request) {
        this.inflight.delete(key.id)
      }
    }
    promise.then(release, release)
    return promise
  }

  /** Drops every key starting with the prefix (all keys when omitted). */
  invalidate(prefix = ""): void {
    this.generation += 1
    for (const id of [...this.entries.keys()]) {
      if (id.startsWith(prefix)) {
        this.entries.delete(id)
      }
    }
    for (const id of [...this.inflight.keys()]) {
      if (id.startsWith(prefix)) {
        this.inflight.delete(id)
      }
    }
  }

  clear(): void {
    this.invalidate()
  }
}

/** Shared by the whole app; cleared on sign-out and when settings change. */
export const odooCache = new OdooCache()
