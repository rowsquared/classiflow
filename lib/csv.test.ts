import { describe, expect, it } from 'vitest'
import { parse } from 'csv-parse/sync'
import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('"plain"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell(null)).toBe('""')
  })
})

describe('toCsv', () => {
  const columns = [{ header: 'id' }, { header: 'field_"title"', text: true }, { header: 'isco_1' }]

  it('round-trips quotes, commas and newlines in every column, including headers', () => {
    const csv = toCsv(columns, [['a"1', 'line1\nline2, "quoted"', '0110']], { neutralizeFormulas: true })
    const parsed = parse(csv) as string[][]
    expect(parsed[0]).toEqual(['id', 'field_"title"', 'isco_1'])
    expect(parsed[1]).toEqual(['a"1', 'line1\nline2, "quoted"', '0110'])
  })

  it('neutralises formulas in text columns only, keeping codes exact', () => {
    const csv = toCsv(columns, [['=id', '=HYPERLINK("x")', '-99']], { neutralizeFormulas: true })
    const parsed = parse(csv) as string[][]
    expect(parsed[1]).toEqual(['=id', `'=HYPERLINK("x")`, '-99'])
  })

  it('can export raw values', () => {
    const csv = toCsv(columns, [['1', '@SUM(A1)', '01']], { neutralizeFormulas: false })
    expect((parse(csv) as string[][])[1]).toEqual(['1', '@SUM(A1)', '01'])
  })
})
