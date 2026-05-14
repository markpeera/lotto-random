import {
  DETAIL_REQUEST_BATCH_DELAY_MS,
  DETAIL_REQUEST_BATCH_SIZE,
  ESTIMATED_LIST_PAGE_SIZE,
  LOTTO_API_BASE,
  MAX_HISTORY_LIST_PAGES,
} from '../config.js'
import { runSettledInBatches } from '../lib/async.js'
import { normalizeResultDetail } from './lotteryNormalizer.js'

const DETAIL_REQUEST_RETRY_DELAYS_MS = [600, 1200, 2400]

class ExternalApiError extends Error {
  constructor(message, { status, url } = {}) {
    super(message)
    this.name = 'ExternalApiError'
    this.status = status
    this.url = url
  }
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

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchJsonWithRetries(url) {
  let lastError

  for (let attempt = 0; attempt <= DETAIL_REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchJson(url)
    } catch (error) {
      lastError = error

      const delayMs = DETAIL_REQUEST_RETRY_DELAYS_MS[attempt]
      if (delayMs === undefined) {
        break
      }

      await waitFor(delayMs)
    }
  }

  throw lastError
}

function createBatchError(message, settledResults) {
  const error = new Error(message)
  error.errors = settledResults
    .filter((item) => item.status === 'rejected')
    .map((item) => item.reason)
  return error
}

function getDrawSortValue(drawId) {
  const match = String(drawId ?? '').match(/^(\d{2})(\d{2})(\d{4})$/)

  if (!match) {
    return 0
  }

  const [, day, month, buddhistYear] = match
  return Number(`${buddhistYear}${month}${day}`)
}

function sortDrawItemsByLatest(items) {
  return [...items].sort((a, b) => getDrawSortValue(b.drawDate) - getDrawSortValue(a.drawDate))
}

function createFallbackDrawDetail(draw) {
  return {
    drawDate: draw.id,
    drawPeriod: draw.date ?? draw.id,
    firstPrize: '-',
    last2: '-',
    front3: [],
    back3: [],
    allPrizes: [],
    partial: true,
  }
}

export async function fetchLotteryResults(limit) {
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
    throw createBatchError('Unable to load lottery result list', listResponses)
  }

  const drawSummaries = [...new Map(listItems
    .filter((item) => item?.id)
    .map((item) => [item.id, {
      id: item.id,
      date: item.date,
    }])).values()]
    .sort((a, b) => getDrawSortValue(b) - getDrawSortValue(a))
    .slice(0, limit)
  const drawDetails = await runSettledInBatches(
    drawSummaries,
    DETAIL_REQUEST_BATCH_SIZE,
    async (draw) => {
      const drawId = draw.id
      const data = await fetchJsonWithRetries(`${LOTTO_API_BASE}/lotto/${drawId}`)

      if (data?.status !== 'success' || !data?.response) {
        throw new Error(`Invalid detail response for draw ${drawId}`)
      }

      return normalizeResultDetail(data.response, drawId)
    },
    DETAIL_REQUEST_BATCH_DELAY_MS,
  )

  const items = drawDetails.map((item, index) => (
    item.status === 'fulfilled'
      ? item.value
      : createFallbackDrawDetail(drawSummaries[index])
  ))

  if (items.length === 0) {
    throw createBatchError('Unable to load lottery result details', drawDetails)
  }

  return {
    items: sortDrawItemsByLatest(items),
    fetchedAt: new Date().toISOString(),
    requestedLimit: limit,
    loadedPages,
    pageCount,
    source: LOTTO_API_BASE,
    partial: drawDetails.some((item) => item.status === 'rejected')
      || items.length < drawSummaries.length,
  }
}
