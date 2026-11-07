import { describe, expect, it } from 'vitest'
import {
  compareAnswers,
  firstDifferingLevel,
  recordStatus,
  participantLabelingAccess,
  recordLabelingAccess,
  summarizeOutcomes,
  taxonomyStatus
} from './double-annotation'

const path = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode }))

describe('double annotation rules', () => {
  it('exposes edit permissions without task or comparison metadata', () => {
    expect(participantLabelingAccess(['A', 'B'], ['A', 'B'])).toEqual({ editableTaxonomies: null })
    expect(participantLabelingAccess(['A'], ['A', 'B'])).toEqual({ editableTaxonomies: ['A'] })
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
    // Changed after confirmation by someone who could not decide: ordinary labels.
    const reviewed = { state: 'reviewed' as const, resultCodes: ['8', '83'] }
    expect(taxonomyStatus({ outcome: reviewed, hasLabels: true, codes: ['8', '83'] })).toBe('reviewed')
    expect(taxonomyStatus({ outcome: reviewed, hasLabels: true, codes: ['8', '82'] })).toBe('single')
    expect(taxonomyStatus({ outcome: { state: 'agreed', resultCodes: [] }, hasLabels: true, codes: ['1'] })).toBe(
      'agreed'
    )
    expect(recordStatus(['single', 'agreed'])).toBe('confirmed')
    expect(recordStatus(['provisional', 'agreed'])).toBe('provisional')
    expect(recordStatus(['disagreed', 'unlabelled'])).toBe('needs_review')
    expect(recordStatus(['single', 'unlabelled'])).toBe('partial')
    expect(recordStatus(['unlabelled'])).toBe('unlabelled')
  })
})
