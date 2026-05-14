import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CACHE_FILE, CACHE_TTL_MS } from '../config.js'

const cache = new Map()
const inFlightRequests = new Map()

function parseLimitFromCacheKey(key) {
  const match = key.match(/^lottery-results:(\d+)$/)
  return match ? Number(match[1]) : null
}

function isUsableCacheEntry(key, value) {
  const keyLimit = parseLimitFromCacheKey(key)
  const requestedLimit = Number(value?.payload?.requestedLimit)

  return typeof key === 'string'
    && keyLimit !== null
    && Number.isFinite(requestedLimit)
    && requestedLimit === keyLimit
    && value?.payload?.items?.length > 0
}

export async function loadPersistentCache() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8')
    const entries = JSON.parse(raw)

    if (!Array.isArray(entries)) {
      return
    }

    entries.forEach(([key, value]) => {
      if (isUsableCacheEntry(key, value)) {
        cache.set(key, value)
      }
    })
  } catch {
    // No persisted cache yet, or the cache file is unreadable. The proxy can rebuild it.
  }
}

async function persistCache() {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify([...cache.entries()]), 'utf8')
  } catch {
    // Keep serving the in-memory cache even if disk persistence is unavailable.
  }
}

function getCacheKey(limit) {
  return `lottery-results:${limit}`
}

function isCachedPayloadForLimit(cached, limit) {
  return Number(cached?.payload?.requestedLimit) === limit
    && cached?.payload?.items?.length > 0
}

function cloneCachedPayload(cached, limit) {
  return {
    ...cached.payload,
    items: cached.payload.items.slice(0, limit),
    requestedLimit: limit,
  }
}

function findUsableCache(limit) {
  const exact = cache.get(getCacheKey(limit))

  if (exact) {
    return exact
  }

  return [...cache.values()]
    .filter((item) => item?.payload?.items?.length > 0)
    .sort((a, b) => {
      const enoughItems = Number(b.payload.items.length >= limit) - Number(a.payload.items.length >= limit)

      if (enoughItems !== 0) {
        return enoughItems
      }

      return b.cachedAt - a.cachedAt
    })[0]
}

export async function getCachedOrFreshLotteryResults(limit, fetchFreshResults) {
  const cacheKey = getCacheKey(limit)
  const cached = cache.get(cacheKey)
  const now = Date.now()

  if (cached && isCachedPayloadForLimit(cached, limit) && now - cached.cachedAt < CACHE_TTL_MS) {
    return {
      ...cached.payload,
      cache: { hit: true, stale: false, ttlMs: CACHE_TTL_MS },
    }
  }

  if (!inFlightRequests.has(cacheKey)) {
    inFlightRequests.set(cacheKey, fetchFreshResults(limit)
      .then((payload) => {
        cache.set(cacheKey, {
          cachedAt: Date.now(),
          payload,
        })
        persistCache()
        return payload
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey)
      }))
  }

  try {
    const payload = await inFlightRequests.get(cacheKey)
    return {
      ...payload,
      cache: { hit: false, stale: false, ttlMs: CACHE_TTL_MS },
    }
  } catch (error) {
    const usableCache = findUsableCache(limit)

    if (usableCache) {
      return {
        ...cloneCachedPayload(usableCache, limit),
        warning: error.status === 429 ? 'rate_limited' : 'external_unavailable',
        cache: { hit: true, stale: true, ttlMs: CACHE_TTL_MS },
      }
    }

    throw error
  }
}
