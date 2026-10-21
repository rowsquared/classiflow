'use client'

import { useEffect } from 'react'

// Screens with unsaved work (the labelling screen's chosen but unsubmitted
// labels) register here, so leaving the workspace through the switcher can
// ask first. Page-local navigation (Back to Queue, next record) is unchanged.

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
    return () => {
      dirty.delete(token)
    }
  }, [isDirty])
}
