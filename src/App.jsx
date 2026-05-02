import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BookOpenText,
  ClipboardList,
  Copy,
  History,
  Layers3,
  Radar,
  RefreshCcw,
  Save,
  SearchCheck,
  Send,
  Settings2,
  Sparkles,
  Terminal,
  Trophy,
} from 'lucide-react'
import dreamRules from './data/dream-rules.json'
import symbolRules from './data/symbol-rules.json'
import {
  createGeneratedSlip,
  formatSlipShareText,
  generateFromText,
  generateQuickPicks,
} from './lib/lotteryEngine'
import { readStorage, STORAGE_KEYS, writeStorage } from './lib/storage'

const DEFAULT_QUICK_FORM = {
  digits: 2,
  sets: 4,
  lockedDigits: ['', '', '', '', '', ''],
  excludedDigits: '',
  randomMode: 'balanced',
}

const QUICK_RANDOM_MODES = {
  balanced: 'สุ่มปกติ',
  hot: 'ถ่วงน้ำหนักเลขออกบ่อย',
  cold: 'ถ่วงน้ำหนักเลขออกน้อย',
}

const LOTTO_SOURCE_LABEL = 'Rayriffy Thai Lottery API'
const LOTTERY_RESULTS_API = '/api/lottery-results'
const HISTORY_LIMIT_OPTIONS = [8, 16, 24, 48]
const DEFAULT_RESULTS_LIMIT = 8
const DEFAULT_REFRESH_MINUTES = 10
const MIN_REFRESH_MINUTES = 1
const MAX_REFRESH_MINUTES = 120
const API_RATE_LIMIT_STATUS = 429
const DIGIT_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

const PRIZE_CATALOG = {
  prizeFirst: { label: 'รางวัลที่ 1', amount: 6000000 },
  prizeFirstNear: { label: 'รางวัลข้างเคียงรางวัลที่ 1', amount: 100000 },
  prizeSecond: { label: 'รางวัลที่ 2', amount: 200000 },
  prizeThird: { label: 'รางวัลที่ 3', amount: 80000 },
  prizeFourth: { label: 'รางวัลที่ 4', amount: 40000 },
  prizeFifth: { label: 'รางวัลที่ 5', amount: 20000 },
  runningNumberFrontThree: { label: 'เลขหน้า 3 ตัว', amount: 4000, matchType: 'prefix' },
  runningNumberBackThree: { label: 'เลขท้าย 3 ตัว', amount: 4000, matchType: 'suffix' },
  runningNumberBackTwo: { label: 'เลขท้าย 2 ตัว', amount: 2000, matchType: 'suffix' },
}

const NAV_ITEMS = [
  { id: 'overview', label: 'ภาพรวม', icon: Terminal },
  { id: 'quick-pick', label: 'สุ่มเลขเร็ว', icon: Sparkles },
  { id: 'dream-number', label: 'ตีเลขจากฝัน', icon: BookOpenText },
  { id: 'story-number', label: 'ตีเลขจากสิ่งที่เจอ', icon: Radar },
  { id: 'prize-checker', label: 'ตรวจหวย', icon: Trophy },
  { id: 'history-summary', label: 'สถิติย้อนหลัง', icon: Activity },
  { id: 'results-feed', label: 'ผลย้อนหลัง', icon: History },
]

class ApiRequestError extends Error {
  constructor(message, { status, url } = {}) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.url = url
  }
}

function isRateLimitError(error) {
  return error?.status === API_RATE_LIMIT_STATUS
    || error?.errors?.some((item) => isRateLimitError(item))
}

async function fetchApiJson(url, fallbackMessage) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new ApiRequestError(fallbackMessage, {
      status: response.status,
      url,
    })
  }

  return response.json()
}

function buildResultsLoadNotice(error, cached) {
  const baseMessage = isRateLimitError(error)
    ? 'ผู้ให้บริการข้อมูลผลสลากจำกัดจำนวนการเรียกชั่วคราว ระบบจึงพักการโหลดใหม่'
    : 'ระบบยังเชื่อมต่อข้อมูลผลสลากภายนอกไม่ได้'

  if (cached.items.length > 0) {
    const cachedAt = cached.fetchedAt
      ? new Date(cached.fetchedAt).toLocaleString('th-TH')
      : 'ไม่ระบุเวลา'

    return `${baseMessage} และแสดงข้อมูลสำรองในเครื่อง ${cached.items.length} งวดแทน (อัปเดตล่าสุด ${cachedAt})`
  }

  return `${baseMessage} กรุณาลองใหม่อีกครั้งภายหลัง`
}

function formatCurrency(value) {
  return new Intl.NumberFormat('th-TH', {
    maximumFractionDigits: 0,
  }).format(value)
}

function getFallbackPrizeItems(draw) {
  if (!draw) {
    return []
  }

  return [
    {
      id: 'prizeFirst',
      label: PRIZE_CATALOG.prizeFirst.label,
      amount: PRIZE_CATALOG.prizeFirst.amount,
      numbers: draw.firstPrize && draw.firstPrize !== '-' ? [draw.firstPrize] : [],
      matchType: 'exact',
    },
    {
      id: 'runningNumberFrontThree',
      label: PRIZE_CATALOG.runningNumberFrontThree.label,
      amount: PRIZE_CATALOG.runningNumberFrontThree.amount,
      numbers: draw.front3 ?? [],
      matchType: 'prefix',
    },
    {
      id: 'runningNumberBackThree',
      label: PRIZE_CATALOG.runningNumberBackThree.label,
      amount: PRIZE_CATALOG.runningNumberBackThree.amount,
      numbers: draw.back3 ?? [],
      matchType: 'suffix',
    },
    {
      id: 'runningNumberBackTwo',
      label: PRIZE_CATALOG.runningNumberBackTwo.label,
      amount: PRIZE_CATALOG.runningNumberBackTwo.amount,
      numbers: draw.last2 && draw.last2 !== '-' ? [draw.last2] : [],
      matchType: 'suffix',
    },
  ].filter((item) => item.numbers.length > 0)
}

function checkTicketAgainstDraw(ticketNumber, draw) {
  const normalizedTicket = ticketNumber.replace(/[^\d]/g, '').slice(0, 6)

  if (normalizedTicket.length !== 6 || !draw) {
    return {
      normalizedTicket,
      matches: [],
      totalPrize: 0,
      checkedPrizeCount: 0,
    }
  }

  const prizeItems = draw.allPrizes?.length > 0 ? draw.allPrizes : getFallbackPrizeItems(draw)
  const matches = prizeItems.flatMap((item) =>
    item.numbers
      .filter((number) => {
        if (item.matchType === 'prefix') {
          return normalizedTicket.startsWith(number)
        }

        if (item.matchType === 'suffix') {
          return normalizedTicket.endsWith(number)
        }

        return normalizedTicket === number
      })
      .map((number) => ({
        id: `${item.id}-${number}`,
        label: item.label,
        number,
        amount: item.amount,
      })),
  )

  return {
    normalizedTicket,
    matches,
    totalPrize: matches.reduce((sum, item) => sum + item.amount, 0),
    checkedPrizeCount: prizeItems.reduce((sum, item) => sum + item.numbers.length, 0),
  }
}

function parseTicketNumbers(value) {
  const chunks = value.match(/\d+/g) ?? []
  const tickets = chunks.flatMap((chunk) => {
    if (chunk.length === 6) {
      return [chunk]
    }

    if (chunk.length > 6) {
      return chunk.match(/\d{6}/g) ?? []
    }

    return []
  })

  return [...new Set(tickets)]
}

function incrementCount(map, key, amount = 1) {
  if (!key) {
    return
  }

  map.set(key, (map.get(key) ?? 0) + amount)
}

function sortByCountThenValue(entries) {
  return [...entries].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'th-TH'))
}

function getResultDigitPool(draw) {
  return [
    draw.firstPrize,
    draw.last2,
    ...(draw.front3 ?? []),
    ...(draw.back3 ?? []),
  ]
    .filter(Boolean)
    .join('')
    .replace(/[^\d]/g, '')
    .split('')
}

function getSlipTwoDigitCandidates(slip) {
  const direct2d = slip.recommended2d ?? []
  const from3d = (slip.recommended3d ?? []).map((value) => String(value).slice(-2))
  const from6d = (slip.recommended6d ?? []).map((value) => String(value).slice(-2))

  return [...new Set([...direct2d, ...from3d, ...from6d].map((value) => String(value).replace(/[^\d]/g, '').slice(-2)))]
    .filter((value) => value.length === 2)
}

function buildHistoricalSummary(resultsFeed, savedSlips, drawLimit) {
  const recentDraws = resultsFeed.slice(0, drawLimit)
  const last2Frequency = new Map()
  const last2Occurrences = new Map()
  const digitFrequency = new Map()
  const digitOccurrences = new Map()
  const lastSeenByLast2 = new Map()

  recentDraws.forEach((draw, index) => {
    const last2 = String(draw.last2 ?? '').replace(/[^\d]/g, '').slice(-2)

    if (last2.length === 2) {
      incrementCount(last2Frequency, last2)
      last2Occurrences.set(last2, [...(last2Occurrences.get(last2) ?? []), draw.drawPeriod])
      if (!lastSeenByLast2.has(last2)) {
        lastSeenByLast2.set(last2, {
          value: last2,
          drawPeriod: draw.drawPeriod,
          drawsAgo: index,
        })
      }
    }

    getResultDigitPool(draw).forEach((digit) => {
      incrementCount(digitFrequency, digit)
      digitOccurrences.set(digit, [...new Set([...(digitOccurrences.get(digit) ?? []), draw.drawPeriod])])
    })
  })

  const frequentLast2 = sortByCountThenValue(
    [...last2Frequency.entries()].map(([value, count]) => ({
      value,
      count,
      drawPeriods: last2Occurrences.get(value) ?? [],
    })),
  ).slice(0, 5)

  const overdueLast2 = [...lastSeenByLast2.values()]
    .sort((a, b) => b.drawsAgo - a.drawsAgo || a.value.localeCompare(b.value, 'th-TH'))
    .slice(0, 5)

  const standoutDigits = sortByCountThenValue(
    [...digitFrequency.entries()].map(([value, count]) => ({
      value,
      count,
      drawPeriods: digitOccurrences.get(value) ?? [],
    })),
  ).slice(0, 6)

  const historicalLast2 = new Set([...last2Frequency.keys()])
  const frequentLast2Set = new Set(frequentLast2.map((item) => item.value))
  const overdueLast2Set = new Set(overdueLast2.map((item) => item.value))
  const savedCandidates = savedSlips.flatMap((slip) =>
    getSlipTwoDigitCandidates(slip).map((value) => ({
      value,
      title: slip.title,
    })),
  )
  const savedHistoricalHits = savedCandidates
    .filter((item) => historicalLast2.has(item.value))
    .slice(0, 8)
  const savedFrequentHits = savedCandidates
    .filter((item) => frequentLast2Set.has(item.value))
    .slice(0, 8)
  const savedOverdueHits = savedCandidates
    .filter((item) => overdueLast2Set.has(item.value))
    .slice(0, 8)

  return {
    drawCount: recentDraws.length,
    drawLimit,
    drawRows: recentDraws.map((draw) => ({
      id: draw.drawDate,
      period: draw.drawPeriod,
      firstPrize: draw.firstPrize,
      last2: draw.last2,
      front3: draw.front3 ?? [],
      back3: draw.back3 ?? [],
    })),
    latestDrawPeriod: recentDraws[0]?.drawPeriod ?? '-',
    oldestDrawPeriod: recentDraws.at(-1)?.drawPeriod ?? '-',
    frequentLast2,
    overdueLast2,
    standoutDigits,
    savedHistoricalHits,
    savedFrequentHits,
    savedOverdueHits,
  }
}

function buildQuickPickWeights(historicalSummary, mode) {
  if (mode === 'balanced') {
    return null
  }

  const counts = new Map(historicalSummary.standoutDigits.map((item) => [item.value, item.count]))
  const maxCount = Math.max(1, ...historicalSummary.standoutDigits.map((item) => item.count))

  return Object.fromEntries(
    DIGIT_CHARS.map((digit) => {
      const count = counts.get(digit) ?? 0
      const weight = mode === 'hot' ? count + 1 : maxCount - count + 1

      return [digit, weight]
    }),
  )
}

function getCachedResults() {
  return readStorage(STORAGE_KEYS.lotteryResultsCache, {
    items: [],
    fetchedAt: null,
    requestedLimit: DEFAULT_RESULTS_LIMIT,
    loadedPages: 0,
  })
}

function getInitialRefreshMinutes() {
  const preferences = readStorage(STORAGE_KEYS.uiPreferences, {})
  const fromStorage = Number(preferences.resultsRefreshMinutes)

  if (!Number.isFinite(fromStorage)) {
    return DEFAULT_REFRESH_MINUTES
  }

  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, fromStorage))
}

function getInitialHistoryLimit() {
  const preferences = readStorage(STORAGE_KEYS.uiPreferences, {})
  const fromStorage = Number(preferences.historyResultsLimit)

  return HISTORY_LIMIT_OPTIONS.includes(fromStorage) ? fromStorage : DEFAULT_RESULTS_LIMIT
}

function formatCreatedAt(value) {
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatSyncClock(value) {
  return value
    ? new Date(value).toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'ยังไม่ซิงก์'
}

function SectionTitle({ icon, eyebrow, title, description, action }) {
  const Icon = icon

  return (
    <div className="section-heading">
      <div className="section-heading__copy">
        <p className="eyebrow">{eyebrow}</p>
        <div className="section-heading__title">
          <div className="section-icon">
            <Icon size={17} />
          </div>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  )
}

function NumberGroup({ label, values }) {
  return (
    <div className="number-group">
      <span>{label}</span>
      <div className="chip-row">
        {values.length > 0 ? values.map((value) => <strong key={`${label}-${value}`}>{value}</strong>) : <em>-</em>}
      </div>
    </div>
  )
}

function SlipCard({ slip, onSave, onShare, isSaved }) {
  return (
    <article className="panel slip-card">
      <div className="panel-label-row">
        <p className="eyebrow">ผลลัพธ์ล่าสุด</p>
        <span className="inline-status">{slip.sourceType}</span>
      </div>

      <div className="slip-head">
        <div>
          <h3>{slip.title}</h3>
          <p className="slip-input">{slip.inputText || 'พร้อมสร้างโพยแรกจากโหมดที่เลือก'}</p>
        </div>
        <div className="slip-actions">
          <button type="button" className="ghost-btn" onClick={() => onSave(slip)}>
            <Save size={15} />
            {isSaved ? 'บันทึกแล้ว' : 'บันทึกโพย'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => onShare(slip)}>
            <Send size={15} />
            แชร์
          </button>
        </div>
      </div>

      <div className="slip-grid">
        <NumberGroup label="เลขเด่น" values={slip.highlightNumbers} />
        <NumberGroup label="เลข 2 ตัว" values={slip.recommended2d} />
        <NumberGroup label="เลข 3 ตัว" values={slip.recommended3d} />
        <NumberGroup label="เลข 6 ตัว" values={slip.recommended6d} />
      </div>

      <div className="reason-box">
        <span>ที่มาของเลข</span>
        <ul>
          {slip.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <p className="slip-time">สร้างเมื่อ {formatCreatedAt(slip.createdAt)}</p>
    </article>
  )
}

function MetricCard({ label, value, meta }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{meta}</p>
    </article>
  )
}

function App() {
  const [quickForm, setQuickForm] = useState(DEFAULT_QUICK_FORM)
  const [dreamText, setDreamText] = useState('')
  const [storyText, setStoryText] = useState('')
  const [ticketInput, setTicketInput] = useState('')
  const [selectedDrawDate, setSelectedDrawDate] = useState('')
  const [recentSlips, setRecentSlips] = useState(() => readStorage(STORAGE_KEYS.recentGenerations, []))
  const [savedSlips, setSavedSlips] = useState(() => readStorage(STORAGE_KEYS.savedSlips, []))
  const [message, setMessage] = useState('')
  const [resultsFeed, setResultsFeed] = useState(() => getCachedResults().items)
  const [resultsSourceLabel, setResultsSourceLabel] = useState(() => {
    const cached = getCachedResults()
    return cached.items.length > 0
      ? `แสดงจาก localStorage cache ล่าสุด ${cached.items.length} งวด (${cached.fetchedAt ?? 'ไม่ระบุเวลา'})`
      : 'กำลังรอโหลดผลจาก API ภายนอก'
  })
  const [lastResultsSync, setLastResultsSync] = useState(() => getCachedResults().fetchedAt)
  const [refreshMinutes, setRefreshMinutes] = useState(getInitialRefreshMinutes)
  const [historyLimit, setHistoryLimit] = useState(getInitialHistoryLimit)
  const [isResultsLoading, setIsResultsLoading] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    writeStorage(STORAGE_KEYS.recentGenerations, recentSlips.slice(0, 8))
  }, [recentSlips])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.savedSlips, savedSlips.slice(0, 20))
  }, [savedSlips])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  useEffect(() => {
    const nextPreferences = {
      ...readStorage(STORAGE_KEYS.uiPreferences, {}),
      resultsRefreshMinutes: refreshMinutes,
      historyResultsLimit: historyLimit,
    }

    writeStorage(STORAGE_KEYS.uiPreferences, nextPreferences)
  }, [historyLimit, refreshMinutes])

  useEffect(() => {
    let isActive = true

    const loadRecentResults = async ({ silent = false } = {}) => {
      if (!silent) {
        setIsResultsLoading(true)
      }

      try {
        const data = await fetchApiJson(
          `${LOTTERY_RESULTS_API}?limit=${historyLimit}`,
          'โหลดผลสลากจากระบบกลางไม่สำเร็จ',
        )

        if (data?.status !== 'success' || !data?.response || !Array.isArray(data.response.items)) {
          throw new Error('รูปแบบข้อมูลผลสลากจากระบบกลางไม่ถูกต้อง')
        }

        const resultPayload = data.response
        const items = resultPayload.items
        if (items.length === 0) {
          throw new Error('ไม่พบข้อมูลงวดจากระบบกลาง')
        }

        const fetchedAt = resultPayload.fetchedAt ?? new Date().toISOString()
        writeStorage(STORAGE_KEYS.lotteryResultsCache, {
          items,
          fetchedAt,
          requestedLimit: historyLimit,
          loadedPages: resultPayload.loadedPages,
        })

        if (isActive) {
          setResultsFeed(items)
          setLastResultsSync(fetchedAt)
          setResultsSourceLabel(
            `${resultPayload.cache?.hit ? 'ข้อมูลจาก cache ระบบกลาง' : 'ข้อมูลจากระบบกลาง'} (${LOTTO_SOURCE_LABEL}) โหลด ${items.length}/${historyLimit} งวด จาก ${resultPayload.loadedPages ?? '-'} หน้า (อัปเดตล่าสุด ${new Date(fetchedAt).toLocaleString('th-TH')})${
              resultPayload.cache?.stale
                ? ' ใช้ข้อมูลสำรองเพราะ API ภายนอกยังไม่พร้อม'
                : resultPayload.partial
                  ? ' บางงวดโหลดจาก API ภายนอกไม่สำเร็จ'
                  : ''
            }`,
          )
        }
      } catch (error) {
        const cached = getCachedResults()

        if (isActive) {
          if (cached.items.length > 0) {
            setResultsFeed(cached.items)
            setLastResultsSync(cached.fetchedAt)
            setResultsSourceLabel(buildResultsLoadNotice(error, cached))
          } else {
            setResultsFeed([])
            setLastResultsSync(null)
            setResultsSourceLabel(buildResultsLoadNotice(error, cached))
          }
        }
      } finally {
        if (isActive) {
          setIsResultsLoading(false)
        }
      }
    }

    loadRecentResults()

    const refreshIntervalId = window.setInterval(() => {
      loadRecentResults({ silent: true })
    }, refreshMinutes * 60 * 1000)

    return () => {
      isActive = false
      window.clearInterval(refreshIntervalId)
    }
  }, [historyLimit, refreshMinutes])

  const handleRefreshMinutesChange = (value) => {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      setRefreshMinutes(DEFAULT_REFRESH_MINUTES)
      return
    }

    setRefreshMinutes(Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, parsed)))
  }

  const handleHistoryLimitChange = (value) => {
    const parsed = Number(value)
    setHistoryLimit(HISTORY_LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_RESULTS_LIMIT)
  }

  const latestSlip = recentSlips[0] ?? createGeneratedSlip({
    sourceType: 'welcome',
    inputText: 'เริ่มจากปุ่ม “สุ่มเลขเร็ว” หรือเล่าความฝันของคุณ',
    title: 'พร้อมสร้างโพยแรก',
    highlights: ['0', '8'],
    recommended2d: ['08', '80'],
    recommended3d: ['108', '808'],
    recommended6d: ['080808'],
    reasons: ['หน้าเวอร์ชันนี้ออกแบบใหม่ให้เห็นเลขเด่น ชุดแนะนำ และที่มาของเลขชัดขึ้นในหน้าเดียว'],
  })

  const savedIds = useMemo(() => new Set(savedSlips.map((item) => item.id)), [savedSlips])
  const displayDigits = useMemo(() => {
    const values = latestSlip.highlightNumbers.slice(0, 2)
    while (values.length < 2) {
      values.push('0')
    }
    return values
  }, [latestSlip.highlightNumbers])
  const quickSummary = useMemo(
    () => `สุ่ม ${quickForm.digits} หลัก จำนวน ${quickForm.sets} ชุด · ${QUICK_RANDOM_MODES[quickForm.randomMode]}`,
    [quickForm.digits, quickForm.randomMode, quickForm.sets],
  )
  const selectedDraw = useMemo(() => {
    if (resultsFeed.length === 0) {
      return null
    }

    return resultsFeed.find((item) => item.drawDate === selectedDrawDate) ?? resultsFeed[0]
  }, [resultsFeed, selectedDrawDate])
  const ticketNumbers = useMemo(() => parseTicketNumbers(ticketInput), [ticketInput])
  const ticketChecks = useMemo(
    () => ticketNumbers.map((number) => checkTicketAgainstDraw(number, selectedDraw)),
    [selectedDraw, ticketNumbers],
  )
  const checkerSummary = useMemo(
    () => ({
      totalPrize: ticketChecks.reduce((sum, item) => sum + item.totalPrize, 0),
      totalMatches: ticketChecks.reduce((sum, item) => sum + item.matches.length, 0),
      checkedPrizeCount: ticketChecks[0]?.checkedPrizeCount ?? 0,
      winningTickets: ticketChecks.filter((item) => item.matches.length > 0).length,
    }),
    [ticketChecks],
  )
  const winningTicketChecks = useMemo(
    () => ticketChecks.filter((item) => item.matches.length > 0),
    [ticketChecks],
  )
  const canCheckTicket = ticketNumbers.length > 0 && Boolean(selectedDraw)
  const historicalSummary = useMemo(
    () => buildHistoricalSummary(resultsFeed, savedSlips, historyLimit),
    [historyLimit, resultsFeed, savedSlips],
  )
  const quickPickWeights = useMemo(
    () => buildQuickPickWeights(historicalSummary, quickForm.randomMode),
    [historicalSummary, quickForm.randomMode],
  )
  const topMetrics = useMemo(
    () => [
      {
        label: 'Active_Generations',
        value: String(recentSlips.length).padStart(2, '0'),
        meta: 'โพยล่าสุดในเครื่อง',
      },
      {
        label: 'ที่บันทึกไว้',
        value: String(savedSlips.length).padStart(2, '0'),
        meta: 'รายการที่กดบันทึกไว้',
      },
      {
        label: 'รอบรีเฟรช',
        value: `${refreshMinutes}m`,
        meta: 'รอบดึงผล API อัตโนมัติ',
      },
      {
        label: 'สถานะข้อมูล',
        value: resultsFeed.length > 0 ? 'พร้อมใช้' : 'รอโหลด',
        meta: resultsFeed.length > 0 ? 'มีข้อมูลผลล่าสุด' : 'รอข้อมูลภายนอก',
      },
    ],
    [recentSlips.length, refreshMinutes, resultsFeed.length, savedSlips.length],
  )

  const setFlashMessage = (text) => {
    setMessage(text)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setMessage(''), 1800)
  }

  const pushSlip = (slip) => {
    setRecentSlips((prev) => [slip, ...prev].slice(0, 8))
  }

  const handleQuickPick = () => {
    const excludedDigits = [...new Set(quickForm.excludedDigits.replace(/[^\d]/g, '').split(''))]
    const lockedDigits = quickForm.lockedDigits.slice(0, quickForm.digits)
    const availableDigits = 10 - excludedDigits.length

    if (availableDigits <= 0) {
      setFlashMessage('ต้องเหลือเลขให้สุ่มอย่างน้อย 1 ตัว')
      return
    }

    if (lockedDigits.some((digit) => digit && excludedDigits.includes(digit))) {
      setFlashMessage('เลขที่ล็อกไว้ต้องไม่อยู่ในรายการตัดออก')
      return
    }

    if (quickForm.randomMode !== 'balanced' && historicalSummary.drawCount === 0) {
      setFlashMessage('ต้องมีข้อมูลผลย้อนหลังก่อนจึงจะสุ่มแบบถ่วงน้ำหนักได้')
      return
    }

    const slip = generateQuickPicks({
      digits: quickForm.digits,
      sets: quickForm.sets,
      lockedDigits,
      excludedDigits,
      digitWeights: quickPickWeights,
      modeLabel: QUICK_RANDOM_MODES[quickForm.randomMode],
      historyDrawCount: historicalSummary.drawCount,
    })

    pushSlip(slip)
    setFlashMessage('สร้างโพยสุ่มเลขแล้ว')
  }

  const handleDreamAnalysis = () => {
    if (!dreamText.trim()) {
      setFlashMessage('กรุณาเล่าความฝันก่อน')
      return
    }

    const slip = generateFromText({
      sourceType: 'dream',
      text: dreamText,
      rules: dreamRules,
      title: 'ตีเลขจากความฝัน',
    })

    pushSlip(slip)
    setFlashMessage('ตีเลขจากความฝันเรียบร้อย')
  }

  const handleStoryAnalysis = () => {
    if (!storyText.trim()) {
      setFlashMessage('กรุณาเล่าเหตุการณ์หรือสิ่งที่เจอ')
      return
    }

    const slip = generateFromText({
      sourceType: 'story',
      text: storyText,
      rules: symbolRules,
      title: 'ตีเลขจากสิ่งที่เจอ',
    })

    pushSlip(slip)
    setFlashMessage('ตีเลขจากเรื่องที่เจอเรียบร้อย')
  }

  const handleSaveSlip = (slip) => {
    setSavedSlips((prev) => {
      if (prev.some((item) => item.id === slip.id)) {
        return prev
      }
      return [slip, ...prev].slice(0, 20)
    })
    setFlashMessage('บันทึกโพยไว้แล้ว')
  }

  const handleShareSlip = async (slip) => {
    const text = formatSlipShareText(slip)

    try {
      if (navigator.share) {
        await navigator.share({
          title: slip.title,
          text,
        })
      } else {
        await navigator.clipboard.writeText(text)
      }
      setFlashMessage('คัดลอกหรือแชร์โพยเรียบร้อย')
    } catch {
      setFlashMessage('ยกเลิกการแชร์')
    }
  }

  const copyQuickValue = async (value) => {
    try {
      await navigator.clipboard.writeText(value)
      setFlashMessage(`คัดลอก ${value} แล้ว`)
    } catch {
      setFlashMessage('คัดลอกไม่สำเร็จ')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <a href="#overview" className="brand-mark">
            <Terminal size={18} />
            Lotto Helper
          </a>
          <nav className="topnav">
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <a key={item.id} href={`#${item.id}`}>
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="topbar-meta">
          <div className="status-pill">
            <span className={`status-dot ${isResultsLoading ? 'is-pulsing' : ''}`} />
            <span>{isResultsLoading ? 'กำลังอัปเดตข้อมูล' : 'พร้อมใช้งาน'}</span>
          </div>
          <div className="status-chip">เลขไทย / บันทึกในเครื่อง</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="side-rail">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <a key={id} href={`#${id}`} className="side-rail__item" aria-label={label}>
              {createElement(icon, { size: 18 })}
            </a>
          ))}
          <button
            type="button"
            className="side-rail__item side-rail__item--muted"
            onClick={() => window.location.reload()}
            aria-label="Reload interface"
          >
            <RefreshCcw size={18} />
          </button>
        </aside>

        <div className="dashboard-stack">
          <section id="overview" className="panel hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">ตัวช่วยไอเดียเลข</p>
              <h1>ช่วยคิดเลขได้ง่ายขึ้นในหน้าเดียว ทั้งสุ่มเลข ตีเลข และดูผลย้อนหลัง</h1>
              <p className="hero-text">
                ยกหน้าใช้งานให้เป็นระบบมากขึ้น อ่านง่ายขึ้น และยังคง workflow เดิมครบ:
                สุ่มเลขเร็ว, ตีเลขจากความฝัน, ตีเลขจากเหตุการณ์, บันทึกโพย และติดตามผลย้อนหลังจาก API
              </p>

              <div className="hero-cta">
                <a href="#quick-pick" className="primary-btn">
                  เริ่มสุ่มเลข
                </a>
                <a href="#dream-number" className="secondary-btn">
                  เล่าความฝัน
                </a>
                <a href="#results-feed" className="secondary-btn">
                  ดูผลย้อนหลัง
                </a>
                <a href="#prize-checker" className="secondary-btn">
                  ตรวจหวย
                </a>
              </div>

              <div className="hero-log">
                <p>โหมดที่เลือก: {quickSummary}</p>
                <p>อัปเดตผลล่าสุด: {formatSyncClock(lastResultsSync)}</p>
                <p>สถานะข้อมูล: {resultsFeed.length > 0 ? 'พร้อมใช้งาน' : 'กำลังรอข้อมูลล่าสุด'}</p>
              </div>
            </div>

            <div className="display-card">
              <div className="panel-label-row">
                <p className="eyebrow">เลขเด่นล่าสุด</p>
                <span className="inline-status">แนะนำ</span>
              </div>
              <div className="display-slots">
                {displayDigits.map((digit, index) => (
                  <div key={`${digit}-${index}`} className="display-slot">
                    {digit}
                  </div>
                ))}
              </div>
              <button type="button" className="primary-btn block-btn" onClick={handleQuickPick}>
                สุ่มเลขทันที
              </button>
              <div className="display-meta">
                <span>Latest Slip: {latestSlip.title}</span>
                <span>Hash: {latestSlip.id.slice(0, 12)}</span>
              </div>
            </div>
          </section>

          {message ? <p className="flash-message">{message}</p> : null}

          <section className="metric-strip">
            {topMetrics.map((item) => (
              <MetricCard key={item.label} {...item} />
            ))}
          </section>

          <div className="content-grid">
            <div className="main-column">
              <section id="quick-pick" className="panel">
                <SectionTitle
                  icon={Sparkles}
                  eyebrow="โหมดที่ 1"
                  title="สุ่มเลขเร็ว"
                  description="เลือกจำนวนหลัก ล็อกเลขบางตำแหน่ง และตัดเลขที่ไม่ต้องการออกก่อนรัน"
                  action={<span className="inline-status">ใช้งานง่าย</span>}
                />

                <div className="form-grid">
                  <label>
                    จำนวนหลัก
                    <select
                      value={quickForm.digits}
                      onChange={(event) =>
                        setQuickForm((prev) => ({ ...prev, digits: Number(event.target.value) }))
                      }
                    >
                      <option value={2}>2 ตัว</option>
                      <option value={3}>3 ตัว</option>
                      <option value={6}>6 ตัว</option>
                    </select>
                  </label>

                  <label>
                    วิธีสุ่ม
                    <select
                      value={quickForm.randomMode}
                      onChange={(event) =>
                        setQuickForm((prev) => ({ ...prev, randomMode: event.target.value }))
                      }
                    >
                      {Object.entries(QUICK_RANDOM_MODES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    จำนวนชุด
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={quickForm.sets}
                      onChange={(event) =>
                        setQuickForm((prev) => ({
                          ...prev,
                          sets: Math.min(8, Math.max(1, Number(event.target.value) || 1)),
                        }))
                      }
                    />
                  </label>
                </div>

                <button type="button" className="primary-btn block-btn quick-pick-action" onClick={handleQuickPick}>
                  สร้างโพยสุ่มเลข
                </button>

                <div className="locked-grid">
                  {Array.from({ length: quickForm.digits }).map((_, index) => (
                    <label key={`lock-${index}`}>
                      ล็อกหลัก {index + 1}
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={quickForm.lockedDigits[index]}
                        onChange={(event) => {
                          const next = [...quickForm.lockedDigits]
                          next[index] = event.target.value.replace(/[^\d]/g, '').slice(0, 1)
                          setQuickForm((prev) => ({ ...prev, lockedDigits: next }))
                        }}
                      />
                    </label>
                  ))}
                </div>

                <label className="full-width">
                  ตัดเลขที่ไม่ต้องการออก
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="เช่น 0 หรือ 13 หรือ 668"
                    value={quickForm.excludedDigits}
                    onChange={(event) =>
                      setQuickForm((prev) => ({
                        ...prev,
                        excludedDigits: event.target.value.replace(/[^\d]/g, ''),
                      }))
                    }
                  />
                </label>

                <div className="system-readout">
                  <span className="eyebrow">น้ำหนักจากสถิติย้อนหลัง</span>
                  <strong>{QUICK_RANDOM_MODES[quickForm.randomMode]}</strong>
                  <p>
                    {quickForm.randomMode === 'balanced'
                      ? 'สุ่มกระจายทุกเลขเท่ากัน ไม่ใช้สถิติย้อนหลัง'
                      : `ใช้ความถี่เลขเด่นจาก ${historicalSummary.drawCount}/${historyLimit} งวดล่าสุดเป็นน้ำหนักในการสุ่ม ไม่ใช่การทำนายหรือการการันตีผล`}
                  </p>
                </div>
              </section>

              <section id="dream-number" className="panel">
                <SectionTitle
                  icon={BookOpenText}
                  eyebrow="โหมดที่ 2"
                  title="ตีเลขจากความฝัน"
                  description="เล่าความฝันสั้น ๆ แล้วให้ระบบดึง keyword และเลขสำคัญมาสร้างโพย"
                  action={<span className="inline-status">พิมพ์เล่าได้เลย</span>}
                />

                <textarea
                  value={dreamText}
                  onChange={(event) => setDreamText(event.target.value)}
                  placeholder="เช่น ฝันว่างูเข้าบ้านตอนตี 2 หรือฝันว่าฟันหลุด"
                  rows={5}
                />

                <div className="hint-row">
                  {dreamRules.slice(0, 5).map((rule) => (
                    <button
                      key={rule.keyword}
                      type="button"
                      className="tag-btn"
                      onClick={() => setDreamText((prev) => `${prev} ${rule.keyword}`.trim())}
                    >
                      {rule.keyword}
                    </button>
                  ))}
                </div>

                <button type="button" className="primary-btn block-btn" onClick={handleDreamAnalysis}>
                  วิเคราะห์ความฝัน
                </button>
              </section>

              <section id="story-number" className="panel">
                <SectionTitle
                  icon={SearchCheck}
                  eyebrow="โหมดที่ 3"
                  title="ตีเลขจากสิ่งที่เจอ"
                  description="พิมพ์เหตุการณ์ที่เห็น เช่น เวลา จำนวน สี รถ หรือใบเสร็จ เพื่อจัดชุดเลขเด่น"
                  action={<span className="inline-status">ใช้งานประจำวัน</span>}
                />

                <textarea
                  value={storyText}
                  onChange={(event) => setStoryText(event.target.value)}
                  placeholder="เช่น เห็นแมวดำ 2 ตัวตอน 6 โมงเย็น หรือเจอใบเสร็จ 287 บาท"
                  rows={5}
                />

                <div className="hint-row">
                  {symbolRules.slice(0, 6).map((rule) => (
                    <button
                      key={rule.keyword}
                      type="button"
                      className="tag-btn"
                      onClick={() => setStoryText((prev) => `${prev} ${rule.keyword}`.trim())}
                    >
                      {rule.keyword}
                    </button>
                  ))}
                </div>

                <button type="button" className="primary-btn block-btn" onClick={handleStoryAnalysis}>
                  วิเคราะห์สิ่งที่เจอ
                </button>
              </section>

              <section id="prize-checker" className="panel">
                <SectionTitle
                  icon={Trophy}
                  eyebrow="โหมดที่ 4"
                  title="ตรวจหวย"
                  description="กรอกหรือวางเลขสลาก 6 หลักได้หลายรายการ ระบบจะตรวจรางวัลทั้งหมดในงวดที่เลือกและรวมยอดเงินรางวัลให้อัตโนมัติ"
                  action={
                    <select
                      className="checker-draw-select"
                      value={selectedDraw?.drawDate ?? ''}
                      onChange={(event) => setSelectedDrawDate(event.target.value)}
                      disabled={resultsFeed.length === 0}
                      aria-label="เลือกงวดที่ต้องการตรวจ"
                    >
                      {resultsFeed.length > 0 ? (
                        resultsFeed.map((item) => (
                          <option key={item.drawDate} value={item.drawDate}>
                            {item.drawPeriod}
                          </option>
                        ))
                      ) : (
                        <option value="">รอโหลดผลสลาก</option>
                      )}
                    </select>
                  }
                />

                <label>
                  เลขสลากกินแบ่ง
                  <textarea
                    className="checker-input"
                    value={ticketInput}
                    inputMode="numeric"
                    placeholder="เช่น 123456, 444444 หรือวางหลายบรรทัด&#10;123456&#10;789012&#10;444444"
                    rows={4}
                    onChange={(event) => setTicketInput(event.target.value)}
                  />
                </label>

                <div className={`checker-summary ${canCheckTicket ? 'is-ready' : ''}`}>
                  <div>
                    <span className="eyebrow">ผลการตรวจ</span>
                    <strong>
                      {canCheckTicket
                        ? checkerSummary.totalMatches > 0
                          ? `พบ ${checkerSummary.totalMatches} รางวัล จาก ${checkerSummary.winningTickets} ใบ`
                          : 'ยังไม่มีเลขถูกรางวัล'
                        : 'วางเลข 6 หลักได้หลายรายการ'}
                    </strong>
                    <p>
                      {selectedDraw
                        ? `ตรวจ ${ticketNumbers.length} ใบ จาก ${checkerSummary.checkedPrizeCount} หมายเลขรางวัลของงวด ${selectedDraw.drawPeriod}`
                        : 'ระบบจะตรวจได้หลังจากโหลดผลสลากสำเร็จ'}
                    </p>
                  </div>
                  <div className="checker-total">
                    <span>เงินรางวัลรวม</span>
                    <strong>{formatCurrency(checkerSummary.totalPrize)} บาท</strong>
                  </div>
                </div>

                {canCheckTicket && winningTicketChecks.length > 0 ? (
                  <div className="checker-matches">
                    {winningTicketChecks.map((check) => (
                      <article
                        key={check.normalizedTicket}
                        className={`checker-ticket-result ${check.matches.length > 0 ? 'is-winning' : ''}`}
                      >
                        <div className="checker-ticket-head">
                          <div>
                            <span className="eyebrow">เลขสลาก</span>
                            <strong>{check.normalizedTicket}</strong>
                          </div>
                          <span>{formatCurrency(check.totalPrize)} บาท</span>
                        </div>

                        <div className="checker-prize-list">
                          {check.matches.map((match) => (
                            <div key={match.id} className="checker-match">
                              <div>
                                <strong>{match.label}</strong>
                                <p>เลขที่ตรง: {match.number}</p>
                              </div>
                              <span>{formatCurrency(match.amount)} บาท</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <section id="history-summary" className="panel">
                <SectionTitle
                  icon={Activity}
                  eyebrow="สถิติจากผลย้อนหลัง"
                  title="สรุปสถิติย้อนหลัง"
                  description={`คำนวณจากผลสลากล่าสุดสูงสุด ${historicalSummary.drawLimit} งวดที่โหลดจาก API และเก็บ cache ไว้ในเครื่อง`}
                  action={<span className="inline-status">{historicalSummary.drawCount} งวด</span>}
                />

                <div className="form-grid compact-grid history-control-grid">
                  <label>
                    ช่วงสถิติย้อนหลัง
                    <select value={historyLimit} onChange={(event) => handleHistoryLimitChange(event.target.value)}>
                      {HISTORY_LIMIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} งวดล่าสุด
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="system-readout">
                    <span className="eyebrow">การโหลดข้อมูล</span>
                    <strong>
                      {isResultsLoading
                        ? `กำลังโหลด ${historyLimit} งวด`
                        : `แสดง ${historicalSummary.drawCount}/${historyLimit} งวด`}
                    </strong>
                    <p>ระบบจะดึงหลายหน้า API อัตโนมัติ เช่น /list/1, /list/2 แล้วนำ id ไปโหลดรายละเอียดแต่ละงวด</p>
                  </div>
                </div>

                <div className="history-summary">
                  <div className="history-summary__notice">
                    <div>
                      <span className="eyebrow">แหล่งข้อมูล</span>
                      <strong>
                        {historicalSummary.drawCount > 0
                          ? `ใช้ช่วง ${historicalSummary.latestDrawPeriod} ถึง ${historicalSummary.oldestDrawPeriod}`
                          : 'ยังไม่มีข้อมูลผลย้อนหลังสำหรับคำนวณ'}
                      </strong>
                    </div>
                    <p>
                      ข้อมูลมาจากระบบกลางของแอป โดย backend จะดึงจาก {LOTTO_SOURCE_LABEL} และ cache ไว้ก่อนส่งให้หน้าเว็บ
                      หาก API ภายนอกใช้งานไม่ได้จะใช้ข้อมูลสำรองแทน
                      สรุปนี้เป็นข้อมูลในอดีตเท่านั้น ไม่ใช่การทำนายหรือการการันตีผลงวดถัดไป
                    </p>
                  </div>

                  <div className="history-source-row">
                    <div className="system-readout">
                      <span className="eyebrow">ซิงก์ล่าสุด</span>
                      <strong>{formatSyncClock(lastResultsSync)}</strong>
                      <p>{resultsSourceLabel}</p>
                    </div>
                    <div className="draw-source-list">
                      <span className="eyebrow">งวดที่ใช้คำนวณ</span>
                      <div>
                        {historicalSummary.drawRows.length > 0 ? (
                          historicalSummary.drawRows.map((draw) => (
                            <p key={draw.id}>
                              <strong>{draw.period}</strong>
                              <span>ท้าย 2 ตัว {draw.last2} · รางวัลที่ 1 {draw.firstPrize}</span>
                            </p>
                          ))
                        ) : (
                          <p className="muted">รอข้อมูลผลย้อนหลังจาก API หรือ cache ในเครื่อง</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="history-summary-grid">
                    <article className="history-summary-card">
                      <span className="eyebrow">เลขท้าย 2 ตัวที่ออกบ่อย</span>
                      <div className="summary-chip-row">
                        {historicalSummary.frequentLast2.length > 0 ? (
                          historicalSummary.frequentLast2.map((item) => (
                            <strong key={`frequent-${item.value}`}>
                              {item.value}
                              <small>{item.count} ครั้ง</small>
                              <small>{item.drawPeriods.join(' / ')}</small>
                            </strong>
                          ))
                        ) : (
                          <em>รอข้อมูลผลย้อนหลัง</em>
                        )}
                      </div>
                    </article>

                    <article className="history-summary-card">
                      <span className="eyebrow">เลขท้าย 2 ตัวที่ห่างจากงวดล่าสุด</span>
                      <div className="summary-chip-row">
                        {historicalSummary.overdueLast2.length > 0 ? (
                          historicalSummary.overdueLast2.map((item) => (
                            <strong key={`overdue-${item.value}`}>
                              {item.value}
                              <small>{item.drawsAgo === 0 ? 'งวดล่าสุด' : `${item.drawsAgo} งวดก่อน`}</small>
                              <small>{item.drawPeriod}</small>
                            </strong>
                          ))
                        ) : (
                          <em>รอข้อมูลผลย้อนหลัง</em>
                        )}
                      </div>
                    </article>

                    <article className="history-summary-card">
                      <span className="eyebrow">เลขเด่นจาก {historyLimit} งวดล่าสุด</span>
                      <div className="summary-chip-row">
                        {historicalSummary.standoutDigits.length > 0 ? (
                          historicalSummary.standoutDigits.map((item) => (
                            <strong key={`digit-${item.value}`}>
                              {item.value}
                              <small>{item.count} จุด</small>
                              <small>{item.drawPeriods.slice(0, 3).join(' / ')}</small>
                            </strong>
                          ))
                        ) : (
                          <em>รอข้อมูลผลย้อนหลัง</em>
                        )}
                      </div>
                    </article>

                    <article className="history-summary-card">
                      <span className="eyebrow">เทียบโพยที่บันทึกไว้</span>
                      {savedSlips.length > 0 ? (
                        <div className="saved-stat-list">
                          <p>
                            <strong>{historicalSummary.savedHistoricalHits.length}</strong>
                            {' '}เลขในโพยเคยตรงเลขท้าย 2 ตัวในชุดข้อมูล
                          </p>
                          <p>
                            <strong>{historicalSummary.savedFrequentHits.length}</strong>
                            {' '}เลขในโพยชนกลุ่มที่ออกบ่อย
                          </p>
                          <p>
                            <strong>{historicalSummary.savedOverdueHits.length}</strong>
                            {' '}เลขในโพยชนกลุ่มที่ห่างจากงวดล่าสุด
                          </p>
                        </div>
                      ) : (
                        <p className="muted">บันทึกโพยก่อน แล้วระบบจะเทียบเลข 2 ตัวของคุณกับสถิติย้อนหลังให้อัตโนมัติ</p>
                      )}
                    </article>
                  </div>
                </div>
              </section>

              <section id="results-feed" className="panel">
                <SectionTitle
                  icon={History}
                  eyebrow="ข้อมูลภายนอก"
                  title="ผลย้อนหลัง"
                  description="ดึงหลายงวดย้อนหลังจาก API พร้อม localStorage cache เมื่อ API ไม่พร้อม"
                  action={
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => window.location.reload()}
                      title="รีโหลดข้อมูลทันที"
                    >
                      <RefreshCcw size={15} />
                      รีโหลดข้อมูล
                    </button>
                  }
                />

                <div className="form-grid compact-grid">
                  <label>
                    รีเฟรชอัตโนมัติทุก (นาที)
                    <input
                      type="number"
                      min={MIN_REFRESH_MINUTES}
                      max={MAX_REFRESH_MINUTES}
                      value={refreshMinutes}
                      onChange={(event) => handleRefreshMinutesChange(event.target.value)}
                    />
                  </label>
                  <div className="system-readout">
                    <span className="eyebrow">อัปเดตล่าสุด</span>
                    <strong>{formatSyncClock(lastResultsSync)}</strong>
                    <p>{resultsSourceLabel}</p>
                  </div>
                </div>

                {isResultsLoading ? <p className="muted">กำลังโหลดผลสลากจาก API...</p> : null}

                <div className="results-grid">
                  {resultsFeed.map((item) => (
                    <article key={item.drawDate} className="result-card">
                      <div className="panel-label-row">
                        <p className="eyebrow">{item.drawPeriod}</p>
                        <span className="inline-status">ผลสลาก</span>
                      </div>
                      <h3>{item.firstPrize}</h3>
                      <dl>
                        <div>
                          <dt>เลขท้าย 2 ตัว</dt>
                          <dd>{item.last2}</dd>
                        </div>
                        <div>
                          <dt>หน้า 3 ตัว</dt>
                          <dd>{item.front3.join(' / ')}</dd>
                        </div>
                        <div>
                          <dt>ท้าย 3 ตัว</dt>
                          <dd>{item.back3.join(' / ')}</dd>
                        </div>
                      </dl>
                      <button type="button" className="ghost-btn" onClick={() => copyQuickValue(item.firstPrize)}>
                        <Copy size={15} />
                        คัดลอกรางวัลที่ 1
                      </button>
                    </article>
                  ))}

                  {!isResultsLoading && resultsFeed.length === 0 ? (
                    <p className="muted">ยังไม่มีข้อมูลผลสลากจาก API กรุณาลองใหม่อีกครั้ง</p>
                  ) : null}
                </div>
              </section>
            </div>

            <aside className="side-column">
              <SlipCard
                slip={latestSlip}
                onSave={handleSaveSlip}
                onShare={handleShareSlip}
                isSaved={savedIds.has(latestSlip.id)}
              />

              <section className="panel">
                <SectionTitle
                  icon={ClipboardList}
                  eyebrow="เก็บไว้ดูทีหลัง"
                  title="โพยที่บันทึกไว้"
                  description="เก็บไว้ในเครื่องนี้เท่านั้น ไม่มีระบบสมาชิกในเวอร์ชันปัจจุบัน"
                  action={<span className="inline-status">{savedSlips.length} รายการ</span>}
                />

                <div className="saved-list">
                  {savedSlips.length > 0 ? (
                    savedSlips.map((slip) => (
                      <button key={slip.id} type="button" className="saved-item" onClick={() => handleShareSlip(slip)}>
                        <div>
                          <strong>{slip.title}</strong>
                          <p>{slip.highlightNumbers.join(', ')}</p>
                        </div>
                        <span>{new Date(slip.createdAt).toLocaleDateString('th-TH')}</span>
                      </button>
                    ))
                  ) : (
                    <p className="muted">ยังไม่มีโพยที่บันทึกไว้ กด Save จากผลลัพธ์ล่าสุดได้ทันที</p>
                  )}
                </div>
              </section>

              <section className="panel side-monitor">
                <SectionTitle
                  icon={Layers3}
                  eyebrow="สรุปการใช้งาน"
                  title="ภาพรวมแบบเร็ว"
                  description="ข้อมูลสำคัญที่ควรรู้ก่อนใช้งานและสถานะของข้อมูลล่าสุด"
                  action={<span className="inline-status">อัปเดตแล้ว</span>}
                />

                <div className="monitor-list">
                  <div>
                    <span>Mode</span>
                    <strong>{quickSummary}</strong>
                  </div>
                  <div>
                    <span>โพยล่าสุด</span>
                    <strong>{latestSlip.title}</strong>
                  </div>
                  <div>
                    <span>จำนวนงวด</span>
                    <strong>{historicalSummary.drawCount}/{historyLimit} งวด</strong>
                  </div>
                  <div>
                    <span>การจัดเก็บ</span>
                    <strong>ในเบราว์เซอร์</strong>
                  </div>
                </div>
              </section>
            </aside>
          </div>

          <section className="panel footer-panel">
            <div className="footer-panel__copy">
              <p>พร้อมช่วยคิดเลขและบันทึกโพยในเครื่องของคุณ</p>
              <p>ผลย้อนหลังจะดึงจาก API และมี cache สำรองเมื่อเชื่อมต่อไม่ได้</p>
            </div>
            <div className="footer-panel__meta">
              <span>
                <Activity size={14} />
                รีเฟรชทุก {refreshMinutes} นาที
              </span>
              <span>
                <Settings2 size={14} />
                เก็บข้อมูลในเบราว์เซอร์
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
