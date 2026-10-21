'use client'

import { useState } from 'react'

/**
 * The latest defined value seen so far. TanStack Query drops placeholder data
 * when a request fails; screens that keep the last good results on screen
 * (and say they are out of date) show this instead of an empty state.
 */
export function useLastSuccessful<T>(data: T | undefined): T | undefined {
  const [last, setLast] = useState(data)
  // Adjusting state while rendering (React's documented pattern for derived
  // state): React re-renders this component at once, before any effects.
  if (data !== undefined && data !== last) setLast(data)
  return data ?? last
}
