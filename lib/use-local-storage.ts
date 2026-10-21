'use client'

import { useCallback, useSyncExternalStore } from 'react'

// A small per-browser preference in localStorage (panel open, label style).
// useSyncExternalStore renders the server default during hydration and then
// the stored value, without a hydration mismatch or a setState in an effect.

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** A JSON boolean in localStorage under `key`, `fallback` when unset or unreadable. */
export function useStoredBoolean(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  )
  const value = raw === 'true' ? true : raw === 'false' ? false : fallback
  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Private mode or storage disabled: the preference just is not kept.
      }
      listeners.forEach(listener => listener())
    },
    [key]
  )
  return [value, set]
}
