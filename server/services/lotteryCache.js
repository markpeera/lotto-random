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
  const itemCount = Number(value?.payload?.items?.length ?? 0)
  const isPartialPayload = value?.payload?.partial === true

  return typeof key === 'string'
    && keyLimit !== null
    && Number.isFinite(requestedLimit)
    && requestedLimit === keyLimit
    && itemCount >= requestedLimit
    && !isPartialPayload
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
    && Number(cached?.payload?.items?.length ?? 0) >= limit
    && cached?.payload?.partial !== true
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

  if (isCachedPayloadForLimit(exact, limit)) {
    return exact
  }

  return [...cache.values()]
    .filter((item) => Number(item?.payload?.items?.length ?? 0) >= limit)
    .sort((a, b) => {
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
        if (payload.partial !== true) {
          cache.set(cacheKey, {
            cachedAt: Date.now(),
            payload,
          })
          persistCache()
        }
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
