export const STORAGE_KEYS = {
  savedSlips: 'saved-slips',
  recentGenerations: 'recent-generations',
  uiPreferences: 'ui-preferences',
  lotteryResultsCache: 'lottery-results-cache',
}

export function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage write failures in MVP mode.
  }
}
