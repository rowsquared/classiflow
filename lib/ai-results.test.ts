import { describe, expect, it } from 'vitest'
import { parseLabelingResults } from './ai-results'

describe('parseLabelingResults', () => {
  it('accepts only records of the job and well-formed suggestions', () => {
    const { bySentence, rejected, serviceErrors } = parseLabelingResults({
      suggestions: [
        { sentenceId: 'a', annotations: [{ level: 1, nodeCode: '01', confidence: 0.9 }, { level: 2, nodeCode: '011', confidence: 1.7 }] },
        { sentence_id: 'b', annotations: [{ level: 1, nodeCode: 2 }] },
        { sentenceId: 'not-in-job', annotations: [{ level: 1, nodeCode: '01' }] },
        { sentenceId: 'c', annotations: [{ level: 1, nodeCode: '01' }, { level: 1, nodeCode: '02' }] },
        { sentenceId: 'c', annotations: [] },
        { sentenceId: 'd', annotations: [{ level: 9, nodeCode: '01' }] },
        'garbage',
      ],
      errors: [{ sentenceId: 'e' }],
    }, ['a', 'b', 'c', 'd', 'e'])

    expect(Array.from(bySentence.keys())).toEqual(['a', 'b', 'c'])
    expect(bySentence.get('a')).toEqual([
      { level: 1, nodeCode: '01', confidence: 0.9 },
      { level: 2, nodeCode: '011', confidence: 1 },
    ])
    expect(bySentence.get('b')).toEqual([{ level: 1, nodeCode: '2', confidence: 0 }])
    expect(bySentence.get('c')).toEqual([]) // duplicate level rejected, then empty list accepted
    expect(rejected).toBe(4)
    expect(serviceErrors).toBe(1)
  })

  it('handles a missing or malformed response', () => {
    expect(parseLabelingResults(null, ['a']).bySentence.size).toBe(0)
    expect(parseLabelingResults({ suggestions: 'x' }, ['a']).rejected).toBe(0)
  })
})
