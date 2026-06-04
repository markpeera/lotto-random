import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BookOpenText,
  ClipboardList,
  Copy,
  History,
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

function getDrawSortValue(drawDate) {
  const match = String(drawDate ?? '').match(/^(\d{2})(\d{2})(\d{4})$/)

  if (!match) {
    return 0
  }

  const [, day, month, buddhistYear] = match
  return Number(`${buddhistYear}${month}${day}`)
}

function sortResultsByLatest(items) {
  return [...items].sort((a, b) => getDrawSortValue(b.drawDate) - getDrawSortValue(a.drawDate))
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
  return [draw.firstPrize, draw.last2, ...(draw.front3 ?? []), ...(draw.back3 ?? [])]
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
  const savedHistoricalHits = savedCandidates.filter((item) => historicalLast2.has(item.value)).slice(0, 8)
  const savedFrequentHits = savedCandidates.filter((item) => frequentLast2Set.has(item.value)).slice(0, 8)
  const savedOverdueHits = savedCandidates.filter((item) => overdueLast2Set.has(item.value)).slice(0, 8)

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

function getCachedResults(requiredLimit = DEFAULT_RESULTS_LIMIT) {
  const cached = readStorage(STORAGE_KEYS.lotteryResultsCache, {
    items: [],
    fetchedAt: null,
    requestedLimit: DEFAULT_RESULTS_LIMIT,
    loadedPages: 0,
  })
  const sortedItems = sortResultsByLatest(Array.isArray(cached.items) ? cached.items : [])
  const requestedLimit = Number(cached.requestedLimit)

  if (!Number.isFinite(requestedLimit) || requestedLimit < requiredLimit || sortedItems.length < requiredLimit) {
    return {
      ...cached,
      items: [],
    }
  }

  return {
    ...cached,
    items: sortedItems.slice(0, requiredLimit),
  }
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
    <header className="section-heading">
      <div className="section-heading__copy">
        <p className="eyebrow">{eyebrow}</p>
        <div className="section-heading__title">
          <span className="section-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </header>
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
    <article className="tool-card slip-card">
      <div className="card-topline">
        <p className="eyebrow">ผลลัพธ์ล่าสุด</p>
        <span className="status-badge">{slip.sourceType}</span>
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

function FeatureNav({ items, activeFeature, onChange }) {
  return (
    <div className="feature-nav" role="tablist" aria-label="ฟังก์ชันหลัก">
      {items.map(({ id, label, icon }) => (
        <button
          key={id}
          id={`tab-${id}`}
          type="button"
          role="tab"
          aria-selected={activeFeature === id}
          aria-controls={`panel-${id}`}
          className={`feature-nav__button ${activeFeature === id ? 'is-active' : ''}`}
          onClick={() => onChange(id)}
        >
          {createElement(icon, { size: 16, 'aria-hidden': 'true' })}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

function ShortcutCard({ icon, title, description, meta, onClick, active }) {
  return (
    <button type="button" className={`shortcut-card ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="shortcut-card__icon" aria-hidden="true">
        {createElement(icon, { size: 18 })}
      </span>
      <span className="shortcut-card__copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="shortcut-card__meta">{meta}</span>
    </button>
  )
}

function App() {
  const initialHistoryLimit = getInitialHistoryLimit()
  const [activeFeature, setActiveFeature] = useState('quick-pick')
  const [quickForm, setQuickForm] = useState(DEFAULT_QUICK_FORM)
  const [dreamText, setDreamText] = useState('')
  const [storyText, setStoryText] = useState('')
  const [ticketInput, setTicketInput] = useState('')
  const [selectedDrawDate, setSelectedDrawDate] = useState('')
  const [recentSlips, setRecentSlips] = useState(() => readStorage(STORAGE_KEYS.recentGenerations, []))
  const [savedSlips, setSavedSlips] = useState(() => readStorage(STORAGE_KEYS.savedSlips, []))
  const [message, setMessage] = useState('')
  const [resultsFeed, setResultsFeed] = useState(() => getCachedResults(initialHistoryLimit).items)
  const [resultsSourceLabel, setResultsSourceLabel] = useState(() => {
    const cached = getCachedResults(initialHistoryLimit)
    return cached.items.length > 0
      ? `แสดงจาก localStorage cache ล่าสุด ${cached.items.length} งวด (${cached.fetchedAt ?? 'ไม่ระบุเวลา'})`
      : 'กำลังรอโหลดผลจาก API ภายนอก'
  })
  const [lastResultsSync, setLastResultsSync] = useState(() => getCachedResults(initialHistoryLimit).fetchedAt)
  const [refreshMinutes, setRefreshMinutes] = useState(getInitialRefreshMinutes)
  const [historyLimit, setHistoryLimit] = useState(initialHistoryLimit)
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
        const items = sortResultsByLatest(resultPayload.items)
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
        const cached = getCachedResults(historyLimit)

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
  const latestDraw = resultsFeed[0] ?? null
  const activeFeatureMeta = useMemo(
    () =>
      ({
        overview: {
          eyebrow: 'Dashboard',
          title: 'ภาพรวมการใช้งาน',
          description: 'สรุปทุก workflow หลักในหน้าเดียว พร้อมจุดเข้าใช้งานที่เร็วขึ้นและสถานะข้อมูลแบบสด',
        },
        'quick-pick': {
          eyebrow: 'Generator',
          title: 'สุ่มเลขเร็ว',
          description: 'เลือกโหมดสุ่ม, กำหนดหลักที่ต้องการ, และสร้างโพย 2/3/6 หลักในจังหวะเดียว',
        },
        'dream-number': {
          eyebrow: 'Text Analysis',
          title: 'ตีเลขจากความฝัน',
          description: 'ป้อน narrative สั้น ๆ แล้วให้ระบบดึง keyword และชุดเลขสำคัญออกมาเป็นโพยพร้อมแชร์',
        },
        'story-number': {
          eyebrow: 'Signal Capture',
          title: 'ตีเลขจากสิ่งที่เจอ',
          description: 'ใช้กับทะเบียนรถ เวลา ใบเสร็จ หรือเหตุการณ์รายวัน แล้วแปลงเป็นชุดเลขเด่นอย่างเป็นระบบ',
        },
        'prize-checker': {
          eyebrow: 'Verification',
          title: 'ตรวจหวยหลายเลข',
          description: 'วางเลขสลากได้หลายใบ เลือกงวดเดียว แล้วให้ระบบคัดเฉพาะใบที่ถูกรางวัลพร้อมรวมยอดเงินทันที',
        },
        'history-summary': {
          eyebrow: 'Historical Signals',
          title: 'สรุปสถิติย้อนหลัง',
          description: 'ดูความถี่เลขท้าย 2 ตัว, ช่วงห่างจากงวดล่าสุด, และเทียบกับเลขในโพยที่บันทึกไว้',
        },
        'results-feed': {
          eyebrow: 'Results Feed',
          title: 'ผลย้อนหลัง',
          description: 'ติดตามผลรางวัลย้อนหลังจากระบบกลาง พร้อมสถานะ cache และข้อมูลรีเฟรชล่าสุด',
        },
      })[activeFeature],
    [activeFeature],
  )
  const shortcutCards = useMemo(
    () => [
      {
        id: 'quick-pick',
        title: 'สุ่มเลขทันที',
        description: 'สร้างโพยใหม่จาก mode ปัจจุบัน',
        meta: quickSummary,
        icon: Sparkles,
      },
      {
        id: 'prize-checker',
        title: 'ตรวจรางวัล',
        description: 'วางเลขหลายใบและคัดเฉพาะใบที่ถูก',
        meta: selectedDraw?.drawPeriod ?? 'รอข้อมูลงวด',
        icon: Trophy,
      },
      {
        id: 'history-summary',
        title: 'ดูสถิติย้อนหลัง',
        description: 'ใช้ความถี่เลขช่วยอ่านภาพรวมย้อนหลัง',
        meta: `${historicalSummary.drawCount}/${historyLimit} งวด`,
        icon: Activity,
      },
      {
        id: 'results-feed',
        title: 'เช็กผลล่าสุด',
        description: 'ดูรางวัลที่ 1 และเลขวิ่งในงวดล่าสุด',
        meta: latestDraw?.drawPeriod ?? 'รอผลล่าสุด',
        icon: History,
      },
    ],
    [historyLimit, historicalSummary.drawCount, latestDraw?.drawPeriod, quickSummary, selectedDraw?.drawPeriod],
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

  const renderOverview = () => (
    <section id="panel-overview" className="tool-surface" aria-labelledby="tab-overview">
      <SectionTitle
        icon={Terminal}
        eyebrow="Command Center"
        title="เริ่มจากงานที่ต้องทำตอนนี้"
        description="โครงหน้าใหม่ลดความรกของ workflow เดิมด้วยการดันจุดเริ่มต้น, สถานะข้อมูล, และทางลัดแต่ละโหมดขึ้นมาให้อยู่ในแนวสายตาแรก"
        action={<span className="status-badge">พร้อมใช้งาน</span>}
      />

      <div className="overview-shortcuts">
        {shortcutCards.map((item) => (
          <ShortcutCard
            key={item.id}
            {...item}
            active={activeFeature === item.id}
            onClick={() => setActiveFeature(item.id)}
          />
        ))}
      </div>

      <div className="overview-grid">
        <article className="summary-panel">
          <div className="card-topline">
            <p className="eyebrow">งวดล่าสุด</p>
            <span className="status-badge">{latestDraw?.drawPeriod ?? 'รอข้อมูล'}</span>
          </div>
          {latestDraw ? (
            <div className="draw-hero">
              <div>
                <span>รางวัลที่ 1</span>
                <strong>{latestDraw.firstPrize}</strong>
              </div>
              <div className="draw-hero__chips">
                <b>ท้าย 2 ตัว {latestDraw.last2}</b>
                <b>หน้า 3 ตัว {latestDraw.front3.join(' / ')}</b>
                <b>ท้าย 3 ตัว {latestDraw.back3.join(' / ')}</b>
              </div>
            </div>
          ) : (
            <p className="empty-copy">ยังไม่มีข้อมูลผลสลากล่าสุดในขณะนี้</p>
          )}
        </article>

        <article className="summary-panel">
          <div className="card-topline">
            <p className="eyebrow">สถิติย้อนหลัง</p>
            <span className="status-badge">{historicalSummary.drawCount} งวด</span>
          </div>
          <div className="signal-grid">
            <div>
              <span>เลขท้าย 2 ตัวเด่น</span>
              <strong>{historicalSummary.frequentLast2[0]?.value ?? '--'}</strong>
              <p>{historicalSummary.frequentLast2[0] ? `${historicalSummary.frequentLast2[0].count} ครั้ง` : 'รอข้อมูลย้อนหลัง'}</p>
            </div>
            <div>
              <span>เลขเด่นสุด</span>
              <strong>{historicalSummary.standoutDigits[0]?.value ?? '--'}</strong>
              <p>{historicalSummary.standoutDigits[0] ? `${historicalSummary.standoutDigits[0].count} จุด` : 'ยังไม่มีสัญญาณเด่น'}</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  )

  const renderQuickPick = () => (
    <section id="panel-quick-pick" className="tool-surface" aria-labelledby="tab-quick-pick">
      <SectionTitle
        icon={Sparkles}
        eyebrow="Generator"
        title="สุ่มเลขเร็ว"
        description="ลดจำนวน field ที่ผู้ใช้ต้องสแกนด้วยกลุ่ม control ชุดเดียว แล้วใช้ side summary ช่วยอธิบายโหมดสุ่มปัจจุบัน"
        action={<span className="status-badge">{QUICK_RANDOM_MODES[quickForm.randomMode]}</span>}
      />

      <div className="tool-layout tool-layout--split">
        <div className="form-stack">
          <div className="form-grid form-grid--triple">
            <label htmlFor="quick-digits">
              จำนวนหลัก
              <select
                id="quick-digits"
                value={quickForm.digits}
                onChange={(event) => setQuickForm((prev) => ({ ...prev, digits: Number(event.target.value) }))}
              >
                <option value={2}>2 ตัว</option>
                <option value={3}>3 ตัว</option>
                <option value={6}>6 ตัว</option>
              </select>
            </label>

            <label htmlFor="quick-sets">
              จำนวนชุด
              <input
                id="quick-sets"
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

            <label htmlFor="quick-mode">
              วิธีสุ่ม
              <select
                id="quick-mode"
                value={quickForm.randomMode}
                onChange={(event) => setQuickForm((prev) => ({ ...prev, randomMode: event.target.value }))}
              >
                {Object.entries(QUICK_RANDOM_MODES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="locked-grid">
            {Array.from({ length: quickForm.digits }).map((_, index) => (
              <label key={`lock-${index}`} htmlFor={`lock-${index}`}>
                ล็อกหลัก {index + 1}
                <input
                  id={`lock-${index}`}
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

          <label htmlFor="quick-excluded">
            ตัดเลขที่ไม่ต้องการออก
            <input
              id="quick-excluded"
              type="text"
              inputMode="numeric"
              spellCheck="false"
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

          <button type="button" className="primary-btn block-btn" onClick={handleQuickPick}>
            <Sparkles size={16} />
            สร้างโพยสุ่มเลข
          </button>
        </div>

        <aside className="tool-aside">
          <article className="info-card">
            <span className="eyebrow">กลยุทธ์ที่ใช้</span>
            <strong>{QUICK_RANDOM_MODES[quickForm.randomMode]}</strong>
            <p>
              {quickForm.randomMode === 'balanced'
                ? 'สุ่มแบบกระจายทุกเลขเท่ากัน เหมาะกับการเริ่มต้นแบบไม่ต้องพึ่งสถิติย้อนหลัง'
                : `ใช้ความถี่เลขเด่นจาก ${historicalSummary.drawCount}/${historyLimit} งวดล่าสุดเป็นน้ำหนักในการสุ่ม เพื่อช่วยจัดลำดับความสำคัญของเลข`}
            </p>
          </article>

          <article className="info-card">
            <span className="eyebrow">เลขเด่นล่าสุด</span>
            <div className="display-slots">
              {displayDigits.map((digit, index) => (
                <div key={`${digit}-${index}`} className="display-slot">
                  {digit}
                </div>
              ))}
            </div>
            <p className="info-card__meta">อ้างอิงจากโพยล่าสุดที่สร้างในเครื่อง</p>
          </article>
        </aside>
      </div>
    </section>
  )

  const renderTextAnalysis = (mode) => {
    const isDream = mode === 'dream'
    const value = isDream ? dreamText : storyText
    const setValue = isDream ? setDreamText : setStoryText
    const rules = isDream ? dreamRules.slice(0, 5) : symbolRules.slice(0, 6)
    const title = isDream ? 'ตีเลขจากความฝัน' : 'ตีเลขจากสิ่งที่เจอ'
    const description = isDream
      ? 'พิมพ์ความฝันแบบภาษาคนจริง แล้วใช้ keyword suggestions ช่วยลดแรงคิดก่อนวิเคราะห์'
      : 'เก็บเหตุการณ์รายวันเป็นข้อความ แล้วแปลงเป็นตัวเลขเด่นพร้อมชุดแนะนำสำหรับใช้ต่อ'
    const placeholder = isDream
      ? 'เช่น ฝันว่างูเข้าบ้านตอนตี 2 หรือฝันว่าฟันหลุด'
      : 'เช่น เห็นทะเบียนรถ 287 ตอน 6 โมงเย็น หรือเจอใบเสร็จ 120 บาท'

    return (
      <section
        id={`panel-${isDream ? 'dream-number' : 'story-number'}`}
        className="tool-surface"
        aria-labelledby={`tab-${isDream ? 'dream-number' : 'story-number'}`}
      >
        <SectionTitle
          icon={isDream ? BookOpenText : SearchCheck}
          eyebrow={isDream ? 'Text Analysis' : 'Daily Capture'}
          title={title}
          description={description}
          action={<span className="status-badge">{isDream ? 'พิมพ์เล่าได้เลย' : 'ใช้กับเหตุการณ์จริง'}</span>}
        />

        <div className="tool-layout tool-layout--split">
          <div className="form-stack">
            <label htmlFor={`${mode}-input`}>
              {isDream ? 'เล่าความฝัน' : 'เล่าเหตุการณ์ที่เจอ'}
              <textarea
                id={`${mode}-input`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={placeholder}
                rows={7}
              />
            </label>

            <div className="hint-row" aria-label="คำใบ้ที่กดเติมได้">
              {rules.map((rule) => (
                <button
                  key={rule.keyword}
                  type="button"
                  className="tag-btn"
                  onClick={() => setValue((prev) => `${prev} ${rule.keyword}`.trim())}
                >
                  {rule.keyword}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="primary-btn block-btn"
              onClick={isDream ? handleDreamAnalysis : handleStoryAnalysis}
            >
              {createElement(isDream ? BookOpenText : SearchCheck, { size: 16 })}
              {isDream ? 'วิเคราะห์ความฝัน' : 'วิเคราะห์สิ่งที่เจอ'}
            </button>
          </div>

          <aside className="tool-aside">
            <article className="info-card">
              <span className="eyebrow">ผลลัพธ์ที่ได้</span>
              <strong>เลขเด่น + ชุดแนะนำ + เหตุผล</strong>
              <p>ระบบจะดึง keyword, ตัวเลขที่พบในข้อความ, และกฎจาก dataset เพื่อประกอบเป็นโพยที่อธิบายที่มาได้</p>
            </article>
            <article className="info-card">
              <span className="eyebrow">คำแนะนำการพิมพ์</span>
              <ul className="bullet-list">
                <li>พิมพ์เป็นประโยคสั้น ๆ แบบที่คุณเล่าเองจริง</li>
                <li>ถ้ามีเวลา จำนวนเงิน หรือเลขที่เห็น ให้ใส่ลงไปตรง ๆ</li>
                <li>ระบบจะเก็บผลล่าสุดไว้ให้บันทึกหรือแชร์ต่อทันที</li>
              </ul>
            </article>
          </aside>
        </div>
      </section>
    )
  }

  const renderPrizeChecker = () => (
    <section id="panel-prize-checker" className="tool-surface" aria-labelledby="tab-prize-checker">
      <SectionTitle
        icon={Trophy}
        eyebrow="Verification"
        title="ตรวจหวยหลายเลข"
        description="ออกแบบใหม่ให้ flow ชัดขึ้น: เลือกงวดใน header, วางเลขหลายใบ, ดูเฉพาะเลขที่ถูกรางวัล และรวมยอดเงินแบบไม่รบกวนสายตา"
        action={
          <label className="action-select" htmlFor="selected-draw">
            <span>งวดที่ตรวจ</span>
            <select
              id="selected-draw"
              className="checker-draw-select"
              value={selectedDraw?.drawDate ?? ''}
              onChange={(event) => setSelectedDrawDate(event.target.value)}
              disabled={resultsFeed.length === 0}
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
          </label>
        }
      />

      <div className="tool-layout tool-layout--split">
        <div className="form-stack">
          <label htmlFor="ticket-input">
            เลขสลากกินแบ่ง
            <textarea
              id="ticket-input"
              className="checker-input"
              value={ticketInput}
              inputMode="numeric"
              spellCheck="false"
              placeholder={'เช่น 123456, 444444 หรือวางหลายบรรทัด\n123456\n789012\n444444'}
              rows={8}
              onChange={(event) => setTicketInput(event.target.value)}
            />
          </label>
          <p className="helper-copy">รองรับการวางหลายเลขพร้อมกัน ระบบจะคัดเฉพาะใบที่ถูกรางวัลมาแสดงผลให้โดยอัตโนมัติ</p>
        </div>

        <aside className="tool-aside">
          <article className={`checker-summary ${canCheckTicket ? 'is-ready' : ''}`}>
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
          </article>
        </aside>
      </div>

      {canCheckTicket && winningTicketChecks.length > 0 ? (
        <div className="checker-matches">
          {winningTicketChecks.map((check) => (
            <article key={check.normalizedTicket} className="checker-ticket-result is-winning">
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
      ) : canCheckTicket ? (
        <div className="tool-empty">
          <strong>ยังไม่มีเลขถูกรางวัลในงวดนี้</strong>
          <p>ระบบตรวจครบแล้ว แต่ยังไม่พบเลขที่ตรงกับรายการรางวัลของงวดที่เลือก</p>
        </div>
      ) : null}
    </section>
  )

  const renderHistorySummary = () => (
    <section id="panel-history-summary" className="tool-surface" aria-labelledby="tab-history-summary">
      <SectionTitle
        icon={Activity}
        eyebrow="Historical Signals"
        title="สรุปสถิติย้อนหลัง"
        description={`คำนวณจากผลสลากที่โหลดไว้สูงสุด ${historicalSummary.drawLimit} งวด พร้อมแยกสัญญาณที่ช่วยอ่านภาพรวมได้เร็วขึ้น`}
        action={
          <label className="action-select" htmlFor="history-limit">
            <span>ช่วงข้อมูล</span>
            <select id="history-limit" value={historyLimit} onChange={(event) => handleHistoryLimitChange(event.target.value)}>
              {HISTORY_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} งวดล่าสุด
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="overview-grid">
        <article className="summary-panel">
          <div className="card-topline">
            <p className="eyebrow">แหล่งข้อมูล</p>
            <span className="status-badge">{historicalSummary.drawCount} งวด</span>
          </div>
          <strong className="summary-panel__headline">
            {historicalSummary.drawCount > 0
              ? `ใช้ช่วง ${historicalSummary.latestDrawPeriod} ถึง ${historicalSummary.oldestDrawPeriod}`
              : 'ยังไม่มีข้อมูลผลย้อนหลังสำหรับคำนวณ'}
          </strong>
          <p className="summary-panel__copy">
            ข้อมูลมาจากระบบกลางของแอป โดย backend จะดึงจาก {LOTTO_SOURCE_LABEL} และ cache ไว้ก่อนส่งให้หน้าเว็บ
            สรุปนี้ใช้เพื่อการอ่าน pattern ย้อนหลัง ไม่ใช่การทำนายผลในอนาคต
          </p>
        </article>

        <article className="summary-panel">
          <div className="card-topline">
            <p className="eyebrow">สถานะการโหลด</p>
            <span className="status-badge">{isResultsLoading ? 'กำลังโหลด' : 'พร้อมใช้'}</span>
          </div>
          <strong className="summary-panel__headline">{formatSyncClock(lastResultsSync)}</strong>
          <p className="summary-panel__copy">{resultsSourceLabel}</p>
        </article>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <span>เลขท้าย 2 ตัวที่ออกบ่อย</span>
          <strong>{historicalSummary.frequentLast2[0]?.value ?? '--'}</strong>
          <p>{historicalSummary.frequentLast2[0] ? `${historicalSummary.frequentLast2[0].count} ครั้ง` : 'รอข้อมูลย้อนหลัง'}</p>
        </article>
        <article className="stat-card">
          <span>เลขท้าย 2 ตัวที่ห่าง</span>
          <strong>{historicalSummary.overdueLast2[0]?.value ?? '--'}</strong>
          <p>
            {historicalSummary.overdueLast2[0]
              ? historicalSummary.overdueLast2[0].drawsAgo === 0
                ? 'งวดล่าสุด'
                : `${historicalSummary.overdueLast2[0].drawsAgo} งวดก่อน`
              : 'รอข้อมูลย้อนหลัง'}
          </p>
        </article>
        <article className="stat-card">
          <span>เลขเด่นสูงสุด</span>
          <strong>{historicalSummary.standoutDigits[0]?.value ?? '--'}</strong>
          <p>{historicalSummary.standoutDigits[0] ? `${historicalSummary.standoutDigits[0].count} จุด` : 'ยังไม่มีสัญญาณเด่น'}</p>
        </article>
        <article className="stat-card">
          <span>โพยที่บันทึกไว้</span>
          <strong>{savedSlips.length}</strong>
          <p>พร้อมใช้เทียบกับเลข 2 ตัวย้อนหลัง</p>
        </article>
      </div>

      <div className="history-panels">
        <article className="history-card">
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

        <article className="history-card">
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

        <article className="history-card">
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

        <article className="history-card">
          <span className="eyebrow">เทียบกับโพยที่บันทึกไว้</span>
          {savedSlips.length > 0 ? (
            <div className="saved-stat-list">
              <p>
                <strong>{historicalSummary.savedHistoricalHits.length}</strong> เลขในโพยเคยตรงเลขท้าย 2 ตัวในชุดข้อมูล
              </p>
              <p>
                <strong>{historicalSummary.savedFrequentHits.length}</strong> เลขในโพยชนกลุ่มที่ออกบ่อย
              </p>
              <p>
                <strong>{historicalSummary.savedOverdueHits.length}</strong> เลขในโพยชนกลุ่มที่ห่างจากงวดล่าสุด
              </p>
            </div>
          ) : (
            <p className="empty-copy">บันทึกโพยก่อน แล้วระบบจะช่วยเทียบเลข 2 ตัวของคุณกับสถิติย้อนหลังให้อัตโนมัติ</p>
          )}
        </article>
      </div>
    </section>
  )

  const renderResultsFeed = () => (
    <section id="panel-results-feed" className="tool-surface" aria-labelledby="tab-results-feed">
      <SectionTitle
        icon={History}
        eyebrow="Results Feed"
        title="ผลย้อนหลัง"
        description="ใช้ layout แบบ card collection ที่อ่านเร็วขึ้น พร้อม control ด้านการรีเฟรชและแหล่งข้อมูลในแนวสายตาเดียวกัน"
        action={
          <button type="button" className="ghost-btn" onClick={() => window.location.reload()}>
            <RefreshCcw size={15} />
            รีโหลดข้อมูล
          </button>
        }
      />

      <div className="tool-layout tool-layout--split">
        <div className="form-stack">
          <label htmlFor="refresh-minutes">
            รีเฟรชอัตโนมัติทุก (นาที)
            <input
              id="refresh-minutes"
              type="number"
              min={MIN_REFRESH_MINUTES}
              max={MAX_REFRESH_MINUTES}
              value={refreshMinutes}
              onChange={(event) => handleRefreshMinutesChange(event.target.value)}
            />
          </label>
          {isResultsLoading ? <p className="helper-copy">กำลังโหลดผลสลากจากระบบกลาง...</p> : null}
        </div>

        <aside className="tool-aside">
          <article className="info-card">
            <span className="eyebrow">อัปเดตล่าสุด</span>
            <strong>{formatSyncClock(lastResultsSync)}</strong>
            <p>{resultsSourceLabel}</p>
          </article>
        </aside>
      </div>

      <div className="results-grid">
        {resultsFeed.map((item) => (
          <article key={item.drawDate} className="result-card">
            <div className="card-topline">
              <p className="eyebrow">{item.drawPeriod}</p>
              <span className="status-badge">ผลสลาก</span>
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
          <div className="tool-empty">
            <strong>ยังไม่มีข้อมูลผลสลากย้อนหลัง</strong>
            <p>ระบบยังโหลดผลจาก API ไม่สำเร็จในขณะนี้ ลองรีโหลดอีกครั้งภายหลัง</p>
          </div>
        ) : null}
      </div>
    </section>
  )

  const renderActiveFeature = () => {
    switch (activeFeature) {
      case 'overview':
        return renderOverview()
      case 'quick-pick':
        return renderQuickPick()
      case 'dream-number':
        return renderTextAnalysis('dream')
      case 'story-number':
        return renderTextAnalysis('story')
      case 'prize-checker':
        return renderPrizeChecker()
      case 'history-summary':
        return renderHistorySummary()
      case 'results-feed':
        return renderResultsFeed()
      default:
        return renderOverview()
    }
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand-cluster">
            <button type="button" className="brand-mark" onClick={() => setActiveFeature('overview')}>
              <Terminal size={18} aria-hidden="true" />
              Lotto Helper
            </button>
            <p className="brand-subtitle">Lottery workflow dashboard สำหรับสุ่มเลข, ตีเลข, ตรวจหวย และดูสถิติย้อนหลัง</p>
          </div>

          <div className="topbar-meta">
            <div className="status-pill" aria-live="polite">
              <span className={`status-dot ${isResultsLoading ? 'is-pulsing' : ''}`} />
              <span>{isResultsLoading ? 'กำลังอัปเดตข้อมูล' : 'พร้อมใช้งาน'}</span>
            </div>
            <div className="status-chip">ข้อมูลเก็บในเบราว์เซอร์</div>
          </div>
        </div>
      </header>

      <main id="main-content" className="workspace">
        <section className="hero-band">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Lotto Helper</p>
              <h1>ตรวจหวยและดูผลล่าสุด</h1>
              <p className="hero-text">ดูงวดล่าสุดก่อน แล้วเลือกสุ่มเลขหรือตรวจรางวัลต่อได้ทันที</p>

              <div className="hero-cta">
                <button type="button" className="primary-btn" onClick={() => setActiveFeature('prize-checker')}>
                  <Trophy size={16} />
                  ตรวจหวย
                </button>
                <button type="button" className="secondary-btn" onClick={() => setActiveFeature('quick-pick')}>
                  <Sparkles size={16} />
                  สุ่มเลข
                </button>
              </div>

              <div className="hero-meta" aria-label="สถานะระบบแบบย่อ">
                <span>{isResultsLoading ? 'กำลังอัปเดตผลสลาก' : 'ข้อมูลพร้อมใช้'}</span>
                <span>ซิงก์ {formatSyncClock(lastResultsSync)}</span>
                <span>รีเฟรชทุก {refreshMinutes} นาที</span>
              </div>
            </div>

            <aside className="hero-preview">
              <article className="tool-card latest-draw-card">
                <div className="card-topline">
                  <p className="eyebrow">ภาพรวมสด</p>
                  <span className="status-badge">{latestDraw?.drawPeriod ?? 'รอข้อมูล'}</span>
                </div>

                {latestDraw ? (
                  <div className="latest-draw">
                    <span>รางวัลที่ 1</span>
                    <strong>{latestDraw.firstPrize}</strong>
                    <div className="latest-draw__numbers">
                      <b>ท้าย 2 ตัว {latestDraw.last2}</b>
                      <b>หน้า 3 ตัว {latestDraw.front3.join(' / ')}</b>
                      <b>ท้าย 3 ตัว {latestDraw.back3.join(' / ')}</b>
                    </div>
                  </div>
                ) : (
                  <div className="tool-empty compact">
                    <strong>ยังไม่มีข้อมูลงวดล่าสุด</strong>
                    <p>ระบบกำลังรอผลจากแหล่งข้อมูลภายนอก</p>
                  </div>
                )}
              </article>
            </aside>
          </div>

          {message ? (
            <p className="flash-message" aria-live="polite">
              {message}
            </p>
          ) : null}
        </section>

        <section className="feature-band">
          <div className="feature-band__head">
            <div>
              <p className="eyebrow">{activeFeatureMeta.eyebrow}</p>
              <h2>{activeFeatureMeta.title}</h2>
              <p>{activeFeatureMeta.description}</p>
            </div>
            <div className="feature-band__meta">
              <span className="status-chip">{resultsFeed.length > 0 ? `${resultsFeed.length} งวดพร้อมใช้` : 'กำลังรอผลล่าสุด'}</span>
            </div>
          </div>

          <FeatureNav items={NAV_ITEMS} activeFeature={activeFeature} onChange={setActiveFeature} />

          <div className="workspace-grid">
            <div className="workspace-main">{renderActiveFeature()}</div>

            <aside className="workspace-side">
              <SlipCard
                slip={latestSlip}
                onSave={handleSaveSlip}
                onShare={handleShareSlip}
                isSaved={savedIds.has(latestSlip.id)}
              />

              <section className="tool-card">
                <SectionTitle
                  icon={ClipboardList}
                  eyebrow="Saved Slips"
                  title="โพยที่บันทึกไว้"
                  description="กดแชร์หรือย้อนกลับมาดูเลขเด่นได้จาก sidebar นี้ทันที"
                  action={<span className="status-badge">{savedSlips.length} รายการ</span>}
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
                    <div className="tool-empty compact">
                      <strong>ยังไม่มีโพยที่บันทึกไว้</strong>
                      <p>กดบันทึกจากผลลัพธ์ล่าสุด แล้วรายการจะมาแสดงที่นี่</p>
                    </div>
                  )}
                </div>
              </section>

            </aside>
          </div>
        </section>

        <section className="footer-band">
          <div className="footer-band__copy">
            <p>พร้อมช่วยคิดเลข, ตรวจหวย, และติดตามผลย้อนหลังใน interface เดียวที่อ่านง่ายกว่าเดิม</p>
            <p>ระบบจะดึงข้อมูลผลสลากจาก backend ของแอปและมี cache สำรองเมื่อ API ภายนอกยังไม่พร้อม</p>
          </div>
          <div className="footer-band__meta">
            <span>
              <Activity size={14} />
              รีเฟรชทุก {refreshMinutes} นาที
            </span>
            <span>
              <Settings2 size={14} />
              ข้อมูลอยู่ในเบราว์เซอร์
            </span>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
