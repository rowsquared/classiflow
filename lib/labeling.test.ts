import { describe, expect, it } from 'vitest'
import {
  aiSuggestionPath,
  canSubmitLabels,
  completedTaxonomyKeys,
  labelsFromAnnotations,
  labelsSignature,
  positionForLabels,
  sameLabelPath,
  withUnknownAt,
  type SelectedLabel
} from './labeling'

const label = (level: number, nodeCode: string, extra: Partial<SelectedLabel> = {}): SelectedLabel => ({
  level,
  nodeCode,
  taxonomyKey: 'ISCO',
  ...extra
})

describe('labelsFromAnnotations', () => {
  it('keeps one taxonomy, codes as strings, and the AI source and confidence', () => {
    const labels = labelsFromAnnotations(
      [
        { level: 1, nodeCode: '01', taxonomy: { key: 'ISCO' }, source: 'ai', confidenceScore: 0.8 },
        { level: 1, nodeCode: '7', taxonomy: { key: 'ISIC' } }
      ],
      'ISCO'
    )
    expect(labels).toEqual([
      {
        level: 1,
        nodeCode: '01',
        taxonomyKey: 'ISCO',
        label: '',
        definition: undefined,
        isLeaf: false,
        source: 'ai',
        confidenceScore: 0.8
      }
    ])
  })
})

describe('completedTaxonomyKeys', () => {
  it('counts human labels only, never AI suggestions', () => {
    const done = completedTaxonomyKeys(
      [
        { level: 1, nodeCode: '01', taxonomy: { key: 'ISCO' } },
        { level: 1, nodeCode: '7', taxonomy: { key: 'ISIC' }, source: 'ai' }
      ],
      ['ISCO', 'ISIC']
    )
    expect([...done]).toEqual(['ISCO'])
  })
})

describe('canSubmitLabels', () => {
  it('needs a leaf or an unknown code', () => {
    expect(canSubmitLabels([label(1, '01')], 3)).toBe(false)
    expect(canSubmitLabels([label(1, '01'), label(2, '011', { isLeaf: true })], 3)).toBe(true)
    expect(canSubmitLabels([label(1, '01'), label(2, '-99')], 3)).toBe(true)
  })

  it('accepts a complete AI path ending at a leaf or the maximum depth, not one with gaps', () => {
    const ai = { source: 'ai' as const }
    expect(canSubmitLabels([label(1, '01', ai), label(2, '011', ai)], 2)).toBe(true)
    expect(canSubmitLabels([label(1, '01', ai), label(2, '011', ai)], 3)).toBe(false)
    expect(canSubmitLabels([label(2, '011', ai)], 2)).toBe(false)
  })
})

describe('withUnknownAt', () => {
  it('keeps the levels above and replaces the rest with the level-specific unknown code', () => {
    const labels = [label(1, '01'), label(2, '011'), label(3, '0111')]
    expect(withUnknownAt(labels, 'ISCO', 2).map(l => [l.level, l.nodeCode])).toEqual([
      [1, '01'],
      [2, '-99']
    ])
  })
})

describe('positionForLabels', () => {
  it('opens the first level for an empty selection', () => {
    expect(positionForLabels([], 3)).toEqual({ level: 1, parent: null })
  })

  it('opens the children of the deepest non-leaf label', () => {
    expect(positionForLabels([label(1, '01')], 3)).toEqual({ level: 2, parent: '01' })
  })

  it("stays on a leaf's own level, under its parent", () => {
    expect(positionForLabels([label(2, '011', { isLeaf: true }), label(1, '01')], 3)).toEqual({
      level: 2,
      parent: '01'
    })
    // At the maximum depth a label counts as a leaf.
    expect(positionForLabels([label(1, '01'), label(2, '011')], 2)).toEqual({ level: 2, parent: '01' })
  })
})

describe('selection identity', () => {
  it('ignores order but not codes', () => {
    expect(labelsSignature([label(2, '011'), label(1, '01')])).toBe(labelsSignature([label(1, '01'), label(2, '011')]))
    expect(labelsSignature([label(1, '01')])).not.toBe(labelsSignature([label(1, '1')]))
  })

  it('compares paths by level and code', () => {
    expect(sameLabelPath([label(1, '01')], [label(1, '01', { source: 'ai' })])).toBe(true)
    expect(sameLabelPath([label(1, '01')], [label(1, '02')])).toBe(false)
    expect(sameLabelPath(null, [])).toBe(false)
  })

  it('extracts the AI suggestion, top level first', () => {
    expect(aiSuggestionPath([label(1, '01')])).toBeNull()
    const path = aiSuggestionPath([label(2, '011', { source: 'ai' }), label(1, '01', { source: 'ai' })])
    expect(path?.map(l => l.level)).toEqual([1, 2])
  })
})
