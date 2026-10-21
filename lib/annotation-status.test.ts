import { describe, expect, it } from 'vitest'
import { decideStatus, isComplete } from './annotation-status'

describe('decideStatus', () => {
  it('skip and escalate are explicit and win', () => {
    expect(decideStatus({ requested: 'skipped', current: 'submitted', wroteLabels: true, complete: true })).toBe(
      'skipped'
    )
    expect(decideStatus({ requested: 'escalated', current: 'pending', wroteLabels: false, complete: false })).toBe(
      'escalated'
    )
  })

  it('labels complete or keep pending', () => {
    expect(decideStatus({ requested: 'submitted', current: 'pending', wroteLabels: true, complete: true })).toBe(
      'submitted'
    )
    expect(decideStatus({ requested: 'submitted', current: 'pending', wroteLabels: true, complete: false })).toBe(
      'pending'
    )
    expect(decideStatus({ current: 'skipped', wroteLabels: true, complete: true })).toBe('submitted')
  })

  it('flag/comment-only saves never complete or un-skip a record', () => {
    expect(decideStatus({ requested: 'submitted', current: 'pending', wroteLabels: false, complete: false })).toBe(
      'pending'
    )
    expect(decideStatus({ requested: 'pending', current: 'skipped', wroteLabels: false, complete: true })).toBe(
      'skipped'
    )
    expect(decideStatus({ current: 'escalated', wroteLabels: false, complete: true })).toBe('escalated')
    expect(decideStatus({ current: 'pending', wroteLabels: false, complete: true })).toBe('pending')
    expect(decideStatus({ current: 'submitted', wroteLabels: false, complete: false })).toBe('pending')
  })
})

describe('isComplete', () => {
  it('needs every active taxonomy, and at least one', () => {
    expect(isComplete(new Set(['a', 'b']), ['a', 'b'])).toBe(true)
    expect(isComplete(new Set(['a']), ['a', 'b'])).toBe(false)
    expect(isComplete(new Set(), [])).toBe(false)
  })
})
