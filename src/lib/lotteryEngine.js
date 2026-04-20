const unique = (values) => [...new Set(values.filter(Boolean))]

const clampArray = (values, size) => unique(values).slice(0, size)

const digitChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

function normalizeText(text) {
  return text.trim().toLowerCase()
}

function padToLength(value, length) {
  return value.padStart(length, '0').slice(-length)
}

function pickWeightedDigit(availableDigits, digitWeights) {
  if (!digitWeights) {
    return availableDigits[Math.floor(Math.random() * availableDigits.length)] ?? '0'
  }

  const weightedPool = availableDigits.map((digit) => ({
    digit,
    weight: Math.max(1, Number(digitWeights[digit]) || 1),
  }))
  const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0)
  let cursor = Math.random() * totalWeight

  for (const item of weightedPool) {
    cursor -= item.weight
    if (cursor <= 0) {
      return item.digit
    }
  }

  return weightedPool.at(-1)?.digit ?? '0'
}

function extractSequences(text) {
  return normalizeText(text).match(/\d+/g) ?? []
}

function extractTimeDigits(text) {
  const matches = normalizeText(text).match(/\b(\d{1,2})[:.](\d{1,2})\b/g) ?? []
  return matches.flatMap((match) => match.replace(/[^\d]/g, '').split(''))
}

function extractStandaloneDigits(text) {
  return extractSequences(text).flatMap((chunk) => chunk.split(''))
}

function matchRules(text, rules) {
  const normalized = normalizeText(text)
  return rules.filter((rule) => normalized.includes(rule.keyword))
}

function buildHighlights(primaryNumbers, directDigits) {
  const base = [...primaryNumbers, ...directDigits]
  return clampArray(base.map((item) => item.toString()), 6)
}

function buildRecommended2d(highlights, secondaryNumbers) {
  const pairs = []

  if (highlights.length >= 2) {
    for (let i = 0; i < highlights.length; i += 1) {
      for (let j = 0; j < highlights.length; j += 1) {
        if (i !== j) {
          pairs.push(`${highlights[i]}${highlights[j]}`)
        }
      }
    }
  }

  return clampArray([...secondaryNumbers.filter((value) => value.length === 2), ...pairs], 8)
}

function buildRecommended3d(highlights, secondaryNumbers) {
  const triples = []

  if (highlights.length >= 2) {
    for (let i = 0; i < highlights.length; i += 1) {
      const next = highlights[(i + 1) % highlights.length]
      const third = highlights[(i + 2) % highlights.length] ?? highlights[i]
      triples.push(`${highlights[i]}${next}${third}`)
    }
  }

  return clampArray([...secondaryNumbers.filter((value) => value.length === 3), ...triples], 6)
}

function buildRecommended6d(highlights, directSequences) {
  const fromSequences = directSequences
    .map((value) => padToLength(value.replace(/[^\d]/g, ''), 6))
    .filter(Boolean)

  const repeated = highlights.join('').repeat(6).slice(0, 6)
  const mirrored = [...highlights, ...[...highlights].reverse()].join('').slice(0, 6)

  return clampArray([repeated, mirrored, ...fromSequences], 4)
}

function buildReasons(matches, numberNotes, directSequences, sourceLabel) {
  const reasons = matches.map((match) => match.reasonTemplate)

  if (numberNotes.length > 0) {
    reasons.push(`ข้อความมีตัวเลขสำคัญ ${numberNotes.join(', ')} จึงถูกดึงมาใช้เป็นเลขเด่นร่วมด้วย`)
  }

  if (directSequences.length > 0) {
    reasons.push(`ระบบพบชุดตัวเลขตรงจากข้อความ เช่น ${directSequences.join(', ')} และนำไปต่อยอดเป็นชุดแนะนำ`)
  }

  reasons.push(`ผลลัพธ์นี้มาจากกฎของโหมด ${sourceLabel} เพื่อใช้เป็นไอเดียเลขและความบันเทิง`)

  return clampArray(reasons, 5)
}

export function createGeneratedSlip({
  sourceType,
  inputText,
  highlights,
  recommended2d,
  recommended3d,
  recommended6d,
  reasons,
  title,
}) {
  return {
    id: `${sourceType}-${Date.now()}`,
    sourceType,
    inputText,
    title,
    highlightNumbers: highlights,
    recommended2d,
    recommended3d,
    recommended6d,
    reasons,
    createdAt: new Date().toISOString(),
  }
}

export function generateQuickPicks({
  digits,
  sets,
  lockedDigits,
  excludedDigits,
  digitWeights = null,
  modeLabel = 'สุ่มปกติ',
  historyDrawCount = 0,
}) {
  const results = []
  const excludedSet = new Set(excludedDigits)
  let attempts = 0
  const maxAttempts = 2000
  const availableDigits = digitChars.filter((digit) => !excludedSet.has(digit))

  while (results.length < sets && attempts < maxAttempts) {
    attempts += 1
    const value = Array.from({ length: digits }, (_, index) => {
      const locked = lockedDigits[index]
      if (locked !== '') {
        return locked
      }

      return pickWeightedDigit(availableDigits, digitWeights)
    }).join('')

    if ([...value].some((digit) => excludedSet.has(digit))) {
      continue
    }

    if (!results.includes(value)) {
      results.push(value)
    }
  }

  const highlights = unique(results.join('').split('')).slice(0, 6)
  const reasons = [
    `สุ่มเลข ${digits} หลักจำนวน ${sets} ชุด`,
    lockedDigits.some(Boolean)
      ? `มีการล็อกหลักไว้ที่ ${lockedDigits.map((value, index) => (value ? `${index + 1}=${value}` : null)).filter(Boolean).join(', ')}`
      : 'ไม่มีการล็อกหลัก ระบบจึงกระจายเลขแบบอิสระ',
    excludedDigits.length > 0
      ? `ตัดเลขที่ไม่ต้องการออก: ${excludedDigits.join(', ')}`
      : 'ไม่มีการตัดเลขออกจากชุดสุ่ม',
    digitWeights
      ? `ใช้โหมด ${modeLabel} จากสถิติย้อนหลัง ${historyDrawCount} งวดล่าสุด เพื่อเพิ่มโอกาสหยิบเลขตามน้ำหนักที่คำนวณไว้`
      : `ใช้โหมด ${modeLabel} โดยให้ทุกเลขมีโอกาสถูกหยิบเท่ากัน`,
  ]

  return createGeneratedSlip({
    sourceType: 'quick-pick',
    inputText: `สุ่มเลข ${digits} หลัก`,
    title: `Quick Pick ${digits} หลัก · ${modeLabel}`,
    highlights,
    recommended2d: digits === 2 ? results : results.map((item) => item.slice(-2)).slice(0, 8),
    recommended3d: digits === 3 ? results : results.map((item) => padToLength(item, 3).slice(-3)).slice(0, 6),
    recommended6d: digits === 6 ? results : results.map((item) => padToLength(item, 6)).slice(0, 4),
    reasons,
  })
}

export function generateFromText({ sourceType, text, rules, title }) {
  const trimmed = text.trim()
  const matches = matchRules(trimmed, rules)
  const directSequences = extractSequences(trimmed)
  const timeDigits = extractTimeDigits(trimmed)
  const directDigits = extractStandaloneDigits(trimmed)
  const primaryNumbers = matches.flatMap((rule) => rule.primaryNumbers)
  const secondaryNumbers = matches.flatMap((rule) => rule.secondaryNumbers)
  const highlights = buildHighlights(primaryNumbers, [...timeDigits, ...directDigits])
  const fallbackHighlights = highlights.length > 0 ? highlights : ['1', '6', '9']
  const reasons = buildReasons(matches, unique([...timeDigits, ...directDigits]), directSequences, title)

  return createGeneratedSlip({
    sourceType,
    inputText: trimmed,
    title,
    highlights: fallbackHighlights,
    recommended2d: buildRecommended2d(fallbackHighlights, secondaryNumbers),
    recommended3d: buildRecommended3d(fallbackHighlights, secondaryNumbers),
    recommended6d: buildRecommended6d(fallbackHighlights, directSequences),
    reasons,
  })
}

export function formatSlipShareText(slip) {
  return [
    `โพยจาก ${slip.title}`,
    slip.inputText ? `ต้นทาง: ${slip.inputText}` : null,
    `เลขเด่น: ${slip.highlightNumbers.join(', ')}`,
    `2 ตัว: ${slip.recommended2d.join(' | ') || '-'}`,
    `3 ตัว: ${slip.recommended3d.join(' | ') || '-'}`,
    `6 ตัว: ${slip.recommended6d.join(' | ') || '-'}`,
    `หมายเหตุ: ใช้เป็นไอเดียเลขเพื่อความบันเทิง`,
  ]
    .filter(Boolean)
    .join('\n')
}
