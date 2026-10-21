import { describe, expect, it } from 'vitest'
import { checkLabelPath, sameLabels, type PathNode } from './label-path'

// 01 -> 011 (leaf), 012 -> 0121 (leaf); 02 (leaf)
const nodes = new Map<string, PathNode>([
  ['01', { code: '01', level: 1, parentCode: null, isLeaf: false }],
  ['011', { code: '011', level: 2, parentCode: '01', isLeaf: true }],
  ['012', { code: '012', level: 2, parentCode: '01', isLeaf: false }],
  ['0121', { code: '0121', level: 3, parentCode: '012', isLeaf: true }],
  ['02', { code: '02', level: 1, parentCode: null, isLeaf: true }]
])

const path = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode }))

describe('checkLabelPath', () => {
  it('accepts complete paths to a leaf, in any order', () => {
    expect(checkLabelPath(path('02'), nodes, 3)).toBeNull()
    expect(checkLabelPath(path('01', '012', '0121'), nodes, 3)).toBeNull()
    expect(checkLabelPath([...path('01', '011')].reverse(), nodes, 3)).toBeNull()
  })

  it('accepts a level-specific unknown as the last entry', () => {
    expect(checkLabelPath(path('-9'), nodes, 3)).toBeNull()
    expect(checkLabelPath(path('01', '-99'), nodes, 3)).toBeNull()
    expect(checkLabelPath(path('01', '012', '-999'), nodes, 3)).toBeNull()
  })

  it('rejects incomplete paths', () => {
    expect(checkLabelPath(path('01'), nodes, 3)).toMatch(/not a leaf/)
    expect(checkLabelPath(path('01', '012'), nodes, 3)).toMatch(/not a leaf/)
    expect(checkLabelPath([], nodes, 3)).toMatch(/No labels/)
  })

  it('rejects wrong unknown codes and unknown before the end', () => {
    expect(checkLabelPath(path('01', '-9'), nodes, 3)).toMatch(/must use code -99/)
    expect(
      checkLabelPath(
        [
          { level: 1, nodeCode: '-9' },
          { level: 2, nodeCode: '011' }
        ],
        nodes,
        3
      )
    ).toMatch(/last label/)
  })

  it('rejects broken hierarchy, gaps, duplicates and unknown codes', () => {
    expect(checkLabelPath(path('02', '011'), nodes, 3)).toMatch(/not a child of 02/)
    expect(checkLabelPath(path('011'), nodes, 3)).toMatch(/level 2, not 1/)
    expect(
      checkLabelPath(
        [
          { level: 1, nodeCode: '01' },
          { level: 3, nodeCode: '0121' }
        ],
        nodes,
        3
      )
    ).toMatch(/levels 1..N/)
    expect(
      checkLabelPath(
        [
          { level: 1, nodeCode: '02' },
          { level: 1, nodeCode: '02' }
        ],
        nodes,
        3
      )
    ).toMatch(/levels 1..N/)
    expect(checkLabelPath(path('99'), nodes, 3)).toMatch(/does not exist/)
  })

  it('keeps leading zeros significant', () => {
    expect(checkLabelPath(path('2'), nodes, 3)).toMatch(/does not exist/)
  })

  it('respects the taxonomy depth', () => {
    expect(checkLabelPath(path('01', '012', '0121'), nodes, 2)).toMatch(/at most 2 levels/)
  })
})

describe('sameLabels', () => {
  it('compares paths ignoring order', () => {
    expect(sameLabels(path('01', '011'), [...path('01', '011')].reverse())).toBe(true)
    expect(sameLabels(path('01', '011'), path('01', '-99'))).toBe(false)
  })
})
