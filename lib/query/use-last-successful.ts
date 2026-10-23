'use client'

import { useState } from 'react'

/**
 * The latest defined value seen so far. TanStack Query drops placeholder data
 * when a request fails; screens that keep the last good results on screen
 * (and say they are out of date) show this instead of an empty state.
 */
export function useLastSuccessful<T>(data: T | undefined, scope?: string): T | undefined {
  const [last, setLast] = useState({ data, scope })
  // Adjusting state while rendering (React's documented pattern for derived
  // state): React re-renders this component at once, before any effects.
  if (data !== undefined && (data !== last.data || scope !== last.scope)) setLast({ data, scope })
  return data ?? (scope === last.scope ? last.data : undefined)
}
