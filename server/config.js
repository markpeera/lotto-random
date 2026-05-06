import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const ROOT_DIR = path.resolve(__dirname, '..')
export const DIST_DIR = path.join(ROOT_DIR, 'dist')

export const PORT = Number(process.env.PORT ?? 4173)

export const LOTTO_API_BASE = 'https://lotto.api.rayriffy.com'
export const ESTIMATED_LIST_PAGE_SIZE = 10
export const MAX_HISTORY_LIST_PAGES = 8
export const DEFAULT_RESULTS_LIMIT = 8
export const MAX_RESULTS_LIMIT = 48
export const DETAIL_REQUEST_BATCH_SIZE = 3
export const DETAIL_REQUEST_BATCH_DELAY_MS = 350
export const CACHE_TTL_MS = Number(process.env.LOTTERY_CACHE_TTL_MS ?? 10 * 60 * 1000)
export const CACHE_FILE = process.env.LOTTERY_CACHE_FILE
  ? path.resolve(process.env.LOTTERY_CACHE_FILE)
  : path.join(ROOT_DIR, '.cache', 'lottery-results.json')
