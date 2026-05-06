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

export function normalizeResultDetail(payload, drawId) {
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
