import { describe, expect, it } from 'vitest'
import {
  compareAnswers,
  firstDifferingLevel,
  recordStatus,
  recordLabelingAccess,
  summarizeOutcomes,
  taxonomyStatus
} from './double-annotation'

const path = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode }))

describe('double annotation rules', () => {
  it('exposes edit permissions without task or comparison metadata', () => {
    expect(
      recordLabelingAccess({ mode: 'task', taskStatus: 'pending', required: ['A', 'B'], answered: ['A'] })
    ).toEqual({ editableTaxonomies: ['B'] })
    expect(recordLabelingAccess({ mode: 'hidden' })).toEqual({ editableTaxonomies: [] })
    expect(recordLabelingAccess(null)).toEqual({ editableTaxonomies: null })
  })
  it('compares complete paths with string codes', () => {
    expect(compareAnswers(path('01', '011'), path('01', '011'))).toEqual({ state: 'agreed', matched: true })
    expect(compareAnswers(path('01', '011'), path('1', '011')).state).toBe('disagreed') // leading zero matters
    expect(compareAnswers(path('01'), path('01', '011')).state).toBe('disagreed') // shared ancestor only
    expect(compareAnswers(path('01', '-99'), path('01', '-99')).state).toBe('agreed') // same unknown
  })

  it('finds the first differing level', () => {
    expect(firstDifferingLevel(path('01', '011'), path('01', '012'))).toBe(2)
    expect(firstDifferingLevel(path('01'), path('01', '011'))).toBe(2)
    expect(firstDifferingLevel(path('01'), path('01'))).toBeNull()
  })

  it('summarizes a round: disagreement wins, confirmed needs every taxonomy', () => {
    expect(summarizeOutcomes(['disagreed', 'waiting'])).toBe('review')
    expect(summarizeOutcomes(['agreed', 'waiting'])).toBe('waiting')
    expect(summarizeOutcomes(['agreed', 'reviewed', 'accepted_single'])).toBe('confirmed')
  })

  it('derives export statuses', () => {
    expect(taxonomyStatus({ outcome: null, hasLabels: true })).toBe('single')
    expect(taxonomyStatus({ outcome: null, hasLabels: false })).toBe('unlabelled')
    expect(taxonomyStatus({ outcome: { state: 'waiting' }, hasLabels: true })).toBe('provisional')
    expect(taxonomyStatus({ outcome: { state: 'disagreed' }, hasLabels: true })).toBe('disagreed')
    expect(recordStatus(['single', 'agreed'])).toBe('confirmed')
    expect(recordStatus(['provisional', 'agreed'])).toBe('provisional')
    expect(recordStatus(['disagreed', 'unlabelled'])).toBe('needs_review')
    expect(recordStatus(['single', 'unlabelled'])).toBe('partial')
    expect(recordStatus(['unlabelled'])).toBe('unlabelled')
  })
})
