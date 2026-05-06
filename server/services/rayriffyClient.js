import {
  DETAIL_REQUEST_BATCH_DELAY_MS,
  DETAIL_REQUEST_BATCH_SIZE,
  ESTIMATED_LIST_PAGE_SIZE,
  LOTTO_API_BASE,
  MAX_HISTORY_LIST_PAGES,
} from '../config.js'
import { runSettledInBatches } from '../lib/async.js'
import { normalizeResultDetail } from './lotteryNormalizer.js'

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

function createBatchError(message, settledResults) {
  const error = new Error(message)
  error.errors = settledResults
    .filter((item) => item.status === 'rejected')
    .map((item) => item.reason)
  return error
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
    throw createBatchError('Unable to load lottery result details', drawDetails)
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
