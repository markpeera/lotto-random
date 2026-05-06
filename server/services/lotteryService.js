import { DEFAULT_RESULTS_LIMIT, MAX_RESULTS_LIMIT } from '../config.js'
import { getCachedOrFreshLotteryResults } from './lotteryCache.js'
import { fetchLotteryResults } from './rayriffyClient.js'

export function clampLimit(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_RESULTS_LIMIT
  }

  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.floor(parsed)))
}

export function getLotteryResults(limit) {
  return getCachedOrFreshLotteryResults(limit, fetchLotteryResults)
}
