'use client'

import { useEffect } from 'react'

// Screens with unsaved work (the labelling screen's chosen but unsubmitted
// labels) register here, so leaving the workspace through the switcher can
// ask first. Leaving or reloading the page triggers the browser's warning.

const dirty = new Set<symbol>()

export function hasUnsavedChanges(): boolean {
  return dirty.size > 0
}

/** Marks this component's work as unsaved while `isDirty` is true. */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return
    const token = Symbol('unsaved')
    dirty.add(token)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      dirty.delete(token)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [isDirty])
}
