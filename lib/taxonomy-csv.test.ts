import { describe, expect, it } from 'vitest'
import { parseTaxonomyCsv } from './taxonomy-csv'

const HEAD = 'id,label,parent_id,level'

describe('parseTaxonomyCsv', () => {
  it('parses a tree, keeps leading zeros, derives leaves and paths', () => {
    const { nodes, errors } = parseTaxonomyCsv(
      `﻿${HEAD},synonyms\n01,Group,,1,"a, b"\n011,Item,01,2,c;d|c\n02,Other,,1,\n`
    )
    expect(errors).toEqual([])
    expect(nodes.map(n => [n.code, n.parentCode, n.level, n.isLeaf, n.path])).toEqual([
      ['01', null, 1, false, '01'],
      ['011', '01', 2, true, '01.011'],
      ['02', null, 1, true, '02']
    ])
    expect(nodes[0].synonyms).toEqual(['a', 'b'])
    expect(nodes[1].synonyms).toEqual(['c', 'd'])
  })

  it('reports header problems', () => {
    expect(parseTaxonomyCsv('id,label,level\n1,a,1').errors[0].message).toMatch(/Missing required columns: parent_id/)
    expect(parseTaxonomyCsv(`${HEAD},extra\n1,a,,1,x`).errors[0].message).toMatch(/Disallowed columns: extra/)
    expect(parseTaxonomyCsv(`${HEAD},label\n1,a,,1,b`).errors[0].message).toMatch(/Duplicate columns: label/)
    expect(parseTaxonomyCsv(HEAD).errors[0].message).toMatch(/no data rows/)
  })

  it('reports row problems with row numbers', () => {
    const csv = [HEAD, '01,A,,1', '01,B,,1', '-99,C,,1', ',D,,1', '05,,,1', '06,F,,x', '07,G,,6'].join('\n')
    const msgs = parseTaxonomyCsv(csv).errors.map(e => `${e.row}:${e.message}`)
    expect(msgs).toEqual([
      '3:Duplicate id "01" (also appears in row 2)',
      '4:Code -99 is reserved for UNKNOWN labels and cannot be used',
      '5:Empty id value',
      '6:Empty label value',
      '7:level must be a whole number from 1 to 5 (got "x")',
      '8:level must be a whole number from 1 to 5 (got "6")'
    ])
  })

  it('checks parents and levels, which also rules out cycles', () => {
    const csv = [HEAD, '1,A,,1', '2,B,9,2', '3,C,1,3', '4,D,1,1', '5,E,,2', 'x,X,y,2', 'y,Y,x,2'].join('\n')
    const msgs = parseTaxonomyCsv(csv).errors.map(e => `${e.row}:${e.message}`)
    expect(msgs).toEqual([
      '3:parent_id "9" does not match any id in the file',
      '4:parent_id "1" is at level 1; a level 3 row needs a level 2 parent',
      '5:level 1 rows must have an empty parent_id',
      '6:level 2 rows need a parent_id',
      '7:parent_id "y" is at level 2; a level 2 row needs a level 1 parent',
      '8:parent_id "x" is at level 2; a level 2 row needs a level 1 parent'
    ])
  })

  it('respects the taxonomy depth', () => {
    expect(parseTaxonomyCsv([HEAD, '1,A,,1', '11,B,1,2'].join('\n'), { maxDepth: 1 }).errors[0].message).toMatch(
      /from 1 to 1/
    )
  })

  it('incremental import: parents may already exist, ids may not', () => {
    const existingNodes = new Map([['01', 1]])
    const ok = parseTaxonomyCsv([HEAD, '012,New,01,2'].join('\n'), { existingNodes })
    expect(ok.errors).toEqual([])
    expect(ok.nodes[0].isLeaf).toBe(true)
    const clash = parseTaxonomyCsv([HEAD, '01,Again,,1'].join('\n'), { existingNodes })
    expect(clash.errors[0].message).toMatch(/already exists/)
  })
})
