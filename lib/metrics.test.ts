import { describe, expect, it } from 'vitest'
import { computeAgreement } from './metrics'

const l = (sentenceId: string, taxonomyId: string, level: number, nodeCode: string) => ({
  sentenceId,
  taxonomyId,
  level,
  nodeCode
})

describe('computeAgreement', () => {
  it('matches on record, taxonomy and level', () => {
    const human = [l('s1', 'A', 1, '01'), l('s1', 'B', 1, '01'), l('s2', 'A', 1, '02')]
    const ai = [l('s1', 'A', 1, '01'), l('s1', 'B', 1, '09')]
    expect(computeAgreement(human, ai)).toEqual({ matches: 1, total: 2, rate: 50 })
  })

  it('does not compare across taxonomies with the same level', () => {
    expect(computeAgreement([l('s1', 'A', 1, '01')], [l('s1', 'B', 1, '01')])).toEqual({
      matches: 0,
      total: 0,
      rate: null
    })
  })
})
