import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT_DIR, 'dist')

const PORT = Number(process.env.PORT ?? 4173)
const LOTTO_API_BASE = 'https://lotto.api.rayriffy.com'
const ESTIMATED_LIST_PAGE_SIZE = 10
const MAX_HISTORY_LIST_PAGES = 8
const DEFAULT_RESULTS_LIMIT = 8
const MAX_RESULTS_LIMIT = 48
const DETAIL_REQUEST_BATCH_SIZE = 3
const DETAIL_REQUEST_BATCH_DELAY_MS = 350
const CACHE_TTL_MS = Number(process.env.LOTTERY_CACHE_TTL_MS ?? 10 * 60 * 1000)
const CACHE_FILE = process.env.LOTTERY_CACHE_FILE
  ? path.resolve(process.env.LOTTERY_CACHE_FILE)
  : path.join(ROOT_DIR, '.cache', 'lottery-results.json')

const PRIZE_CATALOG = {
  prizeFirst: { label: 'รางวัลที่ 1', amount: 6000000 },
  prizeFirstNear: { label: 'รางวัลข้างเคียงรางวัลที่ 1', amount: 100000 },
  prizeSecond: { label: 'รางวัลที่ 2', amount: 200000 },
  prizeThird: { label: 'รางวัลที่ 3', amount: 80000 },
  prizeThrid: { label: 'รางวัลที่ 3', amount: 80000 },
  prizeFourth: { label: 'รางวัลที่ 4', amount: 40000 },
  prizeForth: { label: 'รางวัลที่ 4', amount: 40000 },
  prizeFifth: { label: 'รางวัลที่ 5', amount: 20000 },
  runningNumberFrontThree: { label: 'เลขหน้า 3 ตัว', amount: 4000, matchType: 'prefix' },
  runningNumberBackThree: { label: 'เลขท้าย 3 ตัว', amount: 4000, matchType: 'suffix' },
  runningNumberBackTwo: { label: 'เลขท้าย 2 ตัว', amount: 2000, matchType: 'suffix' },
}

const cache = new Map()
const inFlightRequests = new Map()

class ExternalApiError extends Error {
  constructor(message, { status, url } = {}) {
    super(message)
    this.name = 'ExternalApiError'
    this.status = status
    this.url = url
  }
}

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function clampLimit(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_RESULTS_LIMIT
  }

  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.floor(parsed)))
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'lotto-random-proxy/1.0',
    },
  })

  if (!response.ok) {
    throw new ExternalApiError(`External API returned ${response.status}`, {
      status: response.status,
      url,
    })
  }

  return response.json()
}

async function runSettledInBatches(items, batchSize, mapper, delayMs = 0) {
  const results = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.allSettled(batch.map(mapper))
    results.push(...batchResults)

    if (delayMs > 0 && index + batchSize < items.length) {
      await waitFor(delayMs)
    }
  }

  return results
}

function findNumbersById(items, id) {
  return items.find((item) => item.id === id)?.number ?? []
}

function normalizePrizeAmount(item, fallbackAmount) {
  const value = Number(item?.reward ?? item?.amount ?? item?.prize ?? fallbackAmount)
  return Number.isFinite(value) ? value : fallbackAmount
}

function normalizePrizeItem(item) {
  const fallback = PRIZE_CATALOG[item.id] ?? {}

  return {
    id: item.id,
    label: fallback.label ?? item.name ?? item.id,
    amount: normalizePrizeAmount(item, fallback.amount ?? 0),
    numbers: Array.isArray(item.number) ? item.number.map((number) => String(number)) : [],
    matchType: fallback.matchType ?? 'exact',
  }
}

function buildAllPrizes(payload) {
  const prizeItems = (payload.prizes ?? []).map(normalizePrizeItem)
  const runningItems = (payload.runningNumbers ?? []).map(normalizePrizeItem)

  return [...prizeItems, ...runningItems].filter((item) => item.numbers.length > 0)
}

function normalizeResultDetail(payload, drawId) {
  const firstPrize = findNumbersById(payload.prizes ?? [], 'prizeFirst')[0] ?? '-'
  const front3 = findNumbersById(payload.runningNumbers ?? [], 'runningNumberFrontThree')
  const back3 = findNumbersById(payload.runningNumbers ?? [], 'runningNumberBackThree')
  const last2 = findNumbersById(payload.runningNumbers ?? [], 'runningNumberBackTwo')[0] ?? '-'

  return {
    drawDate: drawId ?? `${payload.date}-${firstPrize}`,
    drawPeriod: payload.date ?? 'งวดล่าสุด',
    firstPrize,
    last2,
    front3,
    back3,
    allPrizes: buildAllPrizes(payload),
  }
}

async function fetchLotteryResults(limit) {
  const pageCount = Math.min(
    MAX_HISTORY_LIST_PAGES,
    Math.max(1, Math.ceil(limit / ESTIMATED_LIST_PAGE_SIZE) + 1),
  )
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
  const listResponses = await runSettledInBatches(pageNumbers, 1, async (page) => {
    const data = await fetchJson(`${LOTTO_API_BASE}/list/${page}`)

    if (data?.status !== 'success' || !Array.isArray(data?.response)) {
      throw new Error(`Invalid list response for page ${page}`)
    }

    return data.response
  })

  const listItems = listResponses
    .filter((item) => item.status === 'fulfilled')
    .flatMap((item) => item.value)
  const loadedPages = listResponses.filter((item) => item.status === 'fulfilled').length

  if (listItems.length === 0) {
    const error = new Error('Unable to load lottery result list')
    error.errors = listResponses
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason)
    throw error
  }

  const drawIds = [...new Set(listItems.map((item) => item.id).filter(Boolean))].slice(0, limit)
  const drawDetails = await runSettledInBatches(
    drawIds,
    DETAIL_REQUEST_BATCH_SIZE,
    async (drawId) => {
      const data = await fetchJson(`${LOTTO_API_BASE}/lotto/${drawId}`)

      if (data?.status !== 'success' || !data?.response) {
        throw new Error(`Invalid detail response for draw ${drawId}`)
      }

      return normalizeResultDetail(data.response, drawId)
    },
    DETAIL_REQUEST_BATCH_DELAY_MS,
  )

  const items = drawDetails
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value)

  if (items.length === 0) {
    const error = new Error('Unable to load lottery result details')
    error.errors = drawDetails
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason)
    throw error
  }

  return {
    items,
    fetchedAt: new Date().toISOString(),
    requestedLimit: limit,
    loadedPages,
    pageCount,
    source: LOTTO_API_BASE,
    partial: items.length < drawIds.length,
  }
}

function getCacheKey(limit) {
  return `lottery-results:${limit}`
}

async function loadPersistentCache() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8')
    const entries = JSON.parse(raw)

    if (!Array.isArray(entries)) {
      return
    }

    entries.forEach(([key, value]) => {
      if (typeof key === 'string' && value?.payload?.items?.length > 0) {
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

async function getLotteryResults(limit) {
  const cacheKey = getCacheKey(limit)
  const cached = cache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return {
      ...cached.payload,
      cache: { hit: true, stale: false, ttlMs: CACHE_TTL_MS },
    }
  }

  if (!inFlightRequests.has(cacheKey)) {
    inFlightRequests.set(cacheKey, fetchLotteryResults(limit)
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

async function handleLotteryResults(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const limit = clampLimit(url.searchParams.get('limit'))

  try {
    const payload = await getLotteryResults(limit)
    sendJson(response, 200, {
      status: 'success',
      response: payload,
    })
  } catch (error) {
    const isRateLimited = error.status === 429
      || error.errors?.some((item) => item?.status === 429)

    sendJson(response, isRateLimited ? 429 : 503, {
      status: 'error',
      code: isRateLimited ? 'rate_limited' : 'external_unavailable',
      message: isRateLimited
        ? 'ผู้ให้บริการข้อมูลผลสลากจำกัดจำนวนการเรียกชั่วคราว'
        : 'ระบบยังเชื่อมต่อข้อมูลผลสลากภายนอกไม่ได้',
    })
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const requestedPath = decodeURIComponent(url.pathname)
  const filePath = path.normalize(path.join(DIST_DIR, requestedPath === '/' ? 'index.html' : requestedPath))

  if (!filePath.startsWith(DIST_DIR)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  const finalPath = existsSync(filePath) ? filePath : path.join(DIST_DIR, 'index.html')
  const extension = path.extname(finalPath)
  const contentType = contentTypes[extension] ?? 'application/octet-stream'

  try {
    await readFile(finalPath, { flag: 'r' })
    response.writeHead(200, {
      'content-type': contentType,
    })
    createReadStream(finalPath).pipe(response)
  } catch {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
    })
    response.end('Not found')
  }
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/api/health')) {
    sendJson(response, 200, {
      status: 'ok',
      service: 'lottery-proxy',
    })
    return
  }

  if (request.method === 'GET' && request.url?.startsWith('/api/lottery-results')) {
    handleLotteryResults(request, response)
    return
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStatic(request, response)
    return
  }

  sendJson(response, 405, {
    status: 'error',
    message: 'Method not allowed',
  })
})

await loadPersistentCache()

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing process or set PORT to another value.`)
    process.exit(1)
  }

  throw error
})

server.listen(PORT, () => {
  console.log(`Lotto proxy server listening on http://localhost:${PORT}`)
})
