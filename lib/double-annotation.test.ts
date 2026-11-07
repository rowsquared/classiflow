import { describe, expect, it } from 'vitest'
import {
  KappaTally,
  LevelKappa,
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

describe('kappa', () => {
  it('matches a worked Fleiss example for two ratings per record', () => {
    // 10 records: 8 agree (5 x/x, 3 y/y), 2 disagree (x/y). Pooled: x 12, y 8 of 20.
    const t = new KappaTally()
    for (let i = 0; i < 5; i++) t.add('x', 'x')
    for (let i = 0; i < 3; i++) t.add('y', 'y')
    t.add('x', 'y')
    t.add('y', 'x')
    // p_o = 0.8, p_e = 0.6^2 + 0.4^2 = 0.52, kappa = 0.28 / 0.48
    expect(t.value()).toBeCloseTo(0.28 / 0.48, 10)
  })

  it('is 1 for perfect agreement, null when undefined, negative below chance', () => {
    const perfect = new KappaTally()
    perfect.add('a', 'a')
    perfect.add('b', 'b')
    expect(perfect.value()).toBe(1)
    expect(new KappaTally().value()).toBeNull()
    const one = new KappaTally()
    one.add('a', 'a') // every answer the same code: chance agreement is 1
    expect(one.value()).toBeNull()
    const never = new KappaTally()
    never.add('a', 'b')
    never.add('b', 'a')
    expect(never.value()).toBeLessThan(0)
  })

  it('per level follows the path prefix, like the agreement depth', () => {
    const k = new LevelKappa()
    k.add(['01', '011'], ['01', '012'])
    k.add(['02', '021'], ['02', '021'])
    k.add(['-9'], ['-9']) // identical short paths agree at every level
    k.add(['01'], ['02']) // differ at 1, and so at 2
    const [l1, l2] = k.byLevel(2)
    // level 1: 3 of 4 agree; level 2: 2 of 4 agree
    expect(l1).toBeGreaterThan(l2!)
    expect(k.fullPath()).toBeCloseTo(l2!, 10)
    expect(k.byLevel(3)).toHaveLength(3)
  })
})
