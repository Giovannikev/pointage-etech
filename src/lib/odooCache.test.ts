import { describe, expect, it } from "vitest"

import { cacheKey, OdooCache } from "@/lib/odooCache"

function createCache() {
  const clock = { now: 0 }
  return { clock, cache: new OdooCache(() => clock.now) }
}

describe("OdooCache", () => {
  const key = cacheKey<number>("myTasks")

  it("shares one request between concurrent readers", async () => {
    const { cache } = createCache()
    let calls = 0
    const fetcher = async () => ++calls
    const results = await Promise.all([
      cache.getOrFetch(key, 1000, fetcher),
      cache.getOrFetch(key, 1000, fetcher),
    ])
    expect(results).toEqual([1, 1])
    expect(calls).toBe(1)
  })

  it("serves the stored value until it expires", async () => {
    const { cache, clock } = createCache()
    let calls = 0
    const fetcher = async () => ++calls
    await cache.getOrFetch(key, 1000, fetcher)
    clock.now = 999
    expect(await cache.getOrFetch(key, 1000, fetcher)).toBe(1)
    clock.now = 1000
    expect(cache.peek(key)).toBeUndefined()
    expect(await cache.getOrFetch(key, 1000, fetcher)).toBe(2)
  })

  it("fetches again when forced", async () => {
    const { cache } = createCache()
    let calls = 0
    const fetcher = async () => ++calls
    await cache.getOrFetch(key, 1000, fetcher)
    expect(await cache.getOrFetch(key, 1000, fetcher, { force: true })).toBe(2)
  })

  it("doesn't store a result fetched before an invalidation", async () => {
    const { cache } = createCache()
    const history = cacheKey<number>("history:2026-10-12:2026-10-12")
    let release: (value: number) => void = () => undefined
    const pending = cache.getOrFetch(
      history,
      1000,
      () => new Promise<number>((resolve) => (release = resolve))
    )
    cache.invalidate("history:")
    release(9)
    expect(await pending).toBe(9)
    expect(cache.peek(history)).toBeUndefined()
  })

  it("invalidates by prefix only", async () => {
    const { cache } = createCache()
    cache.set(cacheKey<number>("history:a"), 1, 1000)
    cache.set(key, 2, 1000)
    cache.invalidate("history:")
    expect(cache.peek(cacheKey<number>("history:a"))).toBeUndefined()
    expect(cache.peek(key)).toBe(2)
  })
})
