import { useEffect, useMemo, useRef, useState } from 'react'
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
}

const LOTTO_API_BASE = 'https://lotto.api.rayriffy.com'
const LIST_RESULTS_API = `${LOTTO_API_BASE}/list/1`
const DETAIL_RESULTS_API = `${LOTTO_API_BASE}/lotto`
const RESULTS_LIMIT = 8
const DEFAULT_REFRESH_MINUTES = 10
const MIN_REFRESH_MINUTES = 1
const MAX_REFRESH_MINUTES = 120

const NAV_ITEMS = [
  { id: 'overview', label: 'ภาพรวม', icon: Terminal },
  { id: 'quick-pick', label: 'สุ่มเลขเร็ว', icon: Sparkles },
  { id: 'dream-number', label: 'ตีเลขจากฝัน', icon: BookOpenText },
  { id: 'story-number', label: 'ตีเลขจากสิ่งที่เจอ', icon: Radar },
  { id: 'results-feed', label: 'ผลย้อนหลัง', icon: History },
]

function findNumbersById(items, id) {
  return items.find((item) => item.id === id)?.number ?? []
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
  }
}

function getCachedResults() {
  return readStorage(STORAGE_KEYS.lotteryResultsCache, {
    items: [],
    fetchedAt: null,
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
  const [recentSlips, setRecentSlips] = useState(() => readStorage(STORAGE_KEYS.recentGenerations, []))
  const [savedSlips, setSavedSlips] = useState(() => readStorage(STORAGE_KEYS.savedSlips, []))
  const [message, setMessage] = useState('')
  const [resultsFeed, setResultsFeed] = useState(() => getCachedResults().items)
  const [resultsSourceLabel, setResultsSourceLabel] = useState(() => {
    const cached = getCachedResults()
    return cached.items.length > 0
      ? `แสดงจาก localStorage cache ล่าสุด (${cached.fetchedAt ?? 'ไม่ระบุเวลา'})`
      : 'กำลังรอโหลดผลจาก API ภายนอก'
  })
  const [lastResultsSync, setLastResultsSync] = useState(() => getCachedResults().fetchedAt)
  const [refreshMinutes, setRefreshMinutes] = useState(getInitialRefreshMinutes)
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
    }

    writeStorage(STORAGE_KEYS.uiPreferences, nextPreferences)
  }, [refreshMinutes])

  useEffect(() => {
    let isActive = true

    const loadRecentResults = async ({ silent = false } = {}) => {
      if (!silent) {
        setIsResultsLoading(true)
      }

      try {
        const response = await fetch(LIST_RESULTS_API)
        if (!response.ok) {
          throw new Error('ไม่สามารถโหลดรายการงวดย้อนหลังได้')
        }

        const data = await response.json()
        if (data?.status !== 'success' || !Array.isArray(data?.response)) {
          throw new Error('รูปแบบข้อมูลจาก API ไม่ถูกต้อง')
        }

        const drawIds = data.response
          .map((item) => item.id)
          .filter(Boolean)
          .slice(0, RESULTS_LIMIT)

        const drawDetails = await Promise.allSettled(
          drawIds.map(async (drawId) => {
            const detailResponse = await fetch(`${DETAIL_RESULTS_API}/${drawId}`)

            if (!detailResponse.ok) {
              throw new Error(`โหลดรายละเอียดงวด ${drawId} ไม่สำเร็จ`)
            }

            const detailData = await detailResponse.json()
            if (detailData?.status !== 'success' || !detailData?.response) {
              throw new Error(`ข้อมูลงวด ${drawId} ไม่ถูกต้อง`)
            }

            return normalizeResultDetail(detailData.response, drawId)
          }),
        )

        const items = drawDetails
          .filter((item) => item.status === 'fulfilled')
          .map((item) => item.value)

        if (items.length === 0) {
          throw new Error('ไม่พบข้อมูลงวดจาก API')
        }

        const fetchedAt = new Date().toISOString()
        writeStorage(STORAGE_KEYS.lotteryResultsCache, {
          items,
          fetchedAt,
        })

        if (isActive) {
          setResultsFeed(items)
          setLastResultsSync(fetchedAt)
          setResultsSourceLabel(
            `ข้อมูลจาก API ภายนอก: ${LOTTO_API_BASE} (อัปเดตล่าสุด ${new Date(fetchedAt).toLocaleString('th-TH')})`,
          )
        }
      } catch {
        const cached = getCachedResults()

        if (isActive) {
          if (cached.items.length > 0) {
            setResultsFeed(cached.items)
            setLastResultsSync(cached.fetchedAt)
            setResultsSourceLabel(
              `โหลด API ไม่สำเร็จ จึงใช้ localStorage cache (${cached.fetchedAt ? new Date(cached.fetchedAt).toLocaleString('th-TH') : 'ไม่ระบุเวลา'})`,
            )
          } else {
            setResultsFeed([])
            setLastResultsSync(null)
            setResultsSourceLabel('โหลด API ไม่สำเร็จ และยังไม่มี cache ในเครื่อง')
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
  }, [refreshMinutes])

  const handleRefreshMinutesChange = (value) => {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      setRefreshMinutes(DEFAULT_REFRESH_MINUTES)
      return
    }

    setRefreshMinutes(Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, parsed)))
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
    () => `สุ่ม ${quickForm.digits} หลัก จำนวน ${quickForm.sets} ชุด`,
    [quickForm.digits, quickForm.sets],
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

    const slip = generateQuickPicks({
      digits: quickForm.digits,
      sets: quickForm.sets,
      lockedDigits,
      excludedDigits,
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
            {NAV_ITEMS.slice(0, 4).map((item) => (
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
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} className="side-rail__item" aria-label={label}>
              <Icon size={18} />
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

                <button type="button" className="primary-btn block-btn" onClick={handleQuickPick}>
                  สร้างโพยสุ่มเลข
                </button>
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
                    <strong>{RESULTS_LIMIT} งวด</strong>
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
