function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function runSettledInBatches(items, batchSize, mapper, delayMs = 0) {
  const results = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.allSettled(batch.map(mapper))
    results.push(...batchResults)

    if (delayMs > 0 && index + batchSize < items.length) {
      await waitFor(delayMs)
    }
  }

  return results
}
