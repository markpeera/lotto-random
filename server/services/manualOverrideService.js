import manualOverrides from '../data/manualOverrides.json' with { type: 'json' }

const overrideEntries = manualOverrides.filter((item) => item?.drawDate)

function stripToDigits(value) {
  return String(value ?? '').replace(/[^\d]/g, '')
}

function getDrawSortValue(drawDate) {
  const match = stripToDigits(drawDate).match(/^(\d{2})(\d{2})(\d{4})$/)

  if (!match) {
    return 0
  }

  const [, day, month, buddhistYear] = match
  return Number(`${buddhistYear}${month}${day}`)
}

function sortByLatest(items) {
  return [...items].sort((a, b) => getDrawSortValue(b.drawDate) - getDrawSortValue(a.drawDate))
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNumbersBetween(text, startLabel, endLabel, digitLength) {
  const startIndex = text.indexOf(startLabel)

  if (startIndex === -1) {
    return []
  }

  const sliced = text.slice(startIndex + startLabel.length)
  const endIndex = endLabel ? sliced.indexOf(endLabel) : -1
  const sectionText = endIndex === -1 ? sliced : sliced.slice(0, endIndex)
  const pattern = new RegExp(`\\b\\d{${digitLength}}\\b`, 'g')

  return sectionText.match(pattern) ?? []
}

async function fetchSanookOverride(overrideItem) {
  const response = await fetch(overrideItem.source, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'lotto-random-proxy/1.0',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Sanook override fetch failed with status ${response.status}`)
  }

  const html = await response.text()
  const text = htmlToText(html)

  const prizeFirst = extractNumbersBetween(text, 'รางวัลที่ 1 รางวัลละ 6,000,000 บาท', 'เลขหน้า 3 ตัว', 6)[0]
  const front3 = extractNumbersBetween(text, 'เลขหน้า 3 ตัว 2 รางวัลๆละ 4,000 บาท', 'เลขท้าย 3 ตัว', 3)
  const back3 = extractNumbersBetween(text, 'เลขท้าย 3 ตัว 2 รางวัลๆละ 4,000 บาท', 'เลขท้าย 2 ตัว', 3)
  const last2 = extractNumbersBetween(text, 'เลขท้าย 2 ตัว 1 รางวัลๆละ 2,000 บาท', 'รางวัลข้างเคียงรางวัลที่ 1', 2)[0]
  const prizeFirstNear = extractNumbersBetween(text, 'รางวัลข้างเคียงรางวัลที่ 1 2 รางวัลๆละ 100,000 บาท', 'รางวัลที่ 2', 6)
  const prizeSecond = extractNumbersBetween(text, 'รางวัลที่ 2 มี 5 รางวัลๆละ 200,000 บาท', 'รางวัลที่ 3', 6)
  const prizeThird = extractNumbersBetween(text, 'รางวัลที่ 3 มี 10 รางวัลๆละ 80,000 บาท', 'รางวัลที่ 4', 6)
  const prizeFourth = extractNumbersBetween(text, 'รางวัลที่ 4 มี 50 รางวัลๆละ 40,000 บาท', 'รางวัลที่ 5', 6)
  const prizeFifth = extractNumbersBetween(text, 'รางวัลที่ 5 มี 100 รางวัลๆละ 20,000 บาท', 'วิธีตรวจสลากกินแบ่งรัฐบาล', 6)

  if (!prizeFirst || front3.length < 2 || back3.length < 2 || !last2) {
    throw new Error('Sanook override page structure did not contain the expected draw data')
  }

  return {
    ...overrideItem,
    firstPrize: prizeFirst,
    last2,
    front3: front3.slice(0, 2),
    back3: back3.slice(0, 2),
    allPrizes: [
      { id: 'prizeFirst', label: 'รางวัลที่ 1', amount: 6000000, numbers: [prizeFirst], matchType: 'exact' },
      { id: 'prizeFirstNear', label: 'รางวัลข้างเคียงรางวัลที่ 1', amount: 100000, numbers: prizeFirstNear.slice(0, 2), matchType: 'exact' },
      { id: 'prizeSecond', label: 'รางวัลที่ 2', amount: 200000, numbers: prizeSecond.slice(0, 5), matchType: 'exact' },
      { id: 'prizeThird', label: 'รางวัลที่ 3', amount: 80000, numbers: prizeThird.slice(0, 10), matchType: 'exact' },
      { id: 'prizeFourth', label: 'รางวัลที่ 4', amount: 40000, numbers: prizeFourth.slice(0, 50), matchType: 'exact' },
      { id: 'prizeFifth', label: 'รางวัลที่ 5', amount: 20000, numbers: prizeFifth.slice(0, 100), matchType: 'exact' },
      { id: 'runningNumberFrontThree', label: 'เลขหน้า 3 ตัว', amount: 4000, numbers: front3.slice(0, 2), matchType: 'prefix' },
      { id: 'runningNumberBackThree', label: 'เลขท้าย 3 ตัว', amount: 4000, numbers: back3.slice(0, 2), matchType: 'suffix' },
      { id: 'runningNumberBackTwo', label: 'เลขท้าย 2 ตัว', amount: 2000, numbers: [last2], matchType: 'suffix' },
    ],
    sourceLabel: 'sanook_live',
  }
}

async function resolveOverride(overrideItem) {
  if (!overrideItem?.source?.includes('sanook.com')) {
    return {
      ...overrideItem,
      sourceLabel: 'manual_override',
    }
  }

  try {
    return await fetchSanookOverride(overrideItem)
  } catch {
    return {
      ...overrideItem,
      sourceLabel: 'manual_seed',
    }
  }
}

function mergeOverrideItem(baseItem, overrideItem) {
  if (!baseItem) {
    return overrideItem
  }

  return {
    ...baseItem,
    ...overrideItem,
  }
}

export async function applyManualOverrides(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const mergedMap = new Map(items.map((item) => [String(item.drawDate), item]))
  const resolvedOverrides = await Promise.all(overrideEntries.map((item) => resolveOverride(item)))

  resolvedOverrides.forEach((overrideItem) => {
    mergedMap.set(String(overrideItem.drawDate), mergeOverrideItem(mergedMap.get(String(overrideItem.drawDate)), overrideItem))
  })

  const mergedItems = sortByLatest([...mergedMap.values()])

  return {
    ...payload,
    items: mergedItems.slice(0, Number(payload?.requestedLimit) || mergedItems.length),
    overridesApplied: resolvedOverrides.map((item) => ({
      drawDate: item.drawDate,
      sourceLabel: item.sourceLabel,
      source: item.source,
    })),
  }
}
