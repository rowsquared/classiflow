// Previous/next on the labelling screen walks the queue page the record was
// opened from. The list of ids is kept in sessionStorage (URLs would get too
// long) under a key passed as `?list=`; it expires after an hour.

const MAX_AGE_MS = 60 * 60 * 1000

export type NavigationList = { sentenceIds: string[]; currentIndex: number }

const NO_LIST: NavigationList = { sentenceIds: [], currentIndex: -1 }

/** Stores the list and returns the `?list=` value for opening `sentenceIds[index]`. */
export function storeNavigationList(sentenceIds: string[], index: number): string {
  const storageKey = `sentence-list-${sentenceIds[index]}`
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ sentenceIds, currentIndex: index, timestamp: Date.now() }))
  } catch {
    // Storage full or disabled: the record still opens, without previous/next.
  }
  return storageKey
}

/** The list for this record, or an empty one (no `?list=`, expired, or not in this tab). */
export function readNavigationList(storageKey: string | null, sentenceId: string): NavigationList {
  if (!storageKey || typeof window === 'undefined') return NO_LIST
  try {
    const stored = sessionStorage.getItem(storageKey)
    if (!stored) return NO_LIST
    const data = JSON.parse(stored) as { sentenceIds?: unknown; currentIndex?: unknown; timestamp?: unknown }
    if (typeof data.timestamp !== 'number' || Date.now() - data.timestamp >= MAX_AGE_MS) return NO_LIST
    const ids = Array.isArray(data.sentenceIds)
      ? data.sentenceIds.filter((id): id is string => typeof id === 'string')
      : []
    let index = data.currentIndex !== undefined ? parseInt(String(data.currentIndex), 10) : -1
    // The stored index may point elsewhere (an older entry for this key): trust the id.
    if (ids.length > 0 && index >= 0 && index < ids.length && ids[index] !== sentenceId) {
      const found = ids.indexOf(sentenceId)
      if (found >= 0) index = found
    }
    return { sentenceIds: ids, currentIndex: index }
  } catch {
    return NO_LIST
  }
}
