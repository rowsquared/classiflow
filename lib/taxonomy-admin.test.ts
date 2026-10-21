import { describe, expect, it } from 'vitest'
import { parse } from 'csv-parse/sync'
import { formatImportErrors, hasActiveAIJobs, maxLevelOf } from './taxonomy-admin'

describe('hasActiveAIJobs', () => {
  it('is true while a sync or learning job is pending or processing', () => {
    expect(hasActiveAIJobs([{ lastAISyncStatus: 'completed' }, { lastLearningStatus: 'processing' }])).toBe(true)
    expect(hasActiveAIJobs([{ lastAISyncStatus: 'pending' }])).toBe(true)
  })

  it('is false when everything finished or never ran', () => {
    expect(hasActiveAIJobs([])).toBe(false)
    expect(hasActiveAIJobs([{ lastAISyncStatus: 'failed', lastLearningStatus: null }, {}])).toBe(false)
  })
})

describe('formatImportErrors', () => {
  it('lists row errors under the message, at most the limit', () => {
    const errors = [1, 2, 3].map(row => ({ row, message: `bad ${row}` }))
    expect(formatImportErrors('Invalid file', errors, 2)).toBe(
      'Invalid file\n\nRow 1: bad 1\nRow 2: bad 2\n... and 1 more errors'
    )
  })

  it('returns the message alone without row errors', () => {
    expect(formatImportErrors('Invalid file', undefined)).toBe('Invalid file')
    expect(formatImportErrors('Invalid file', [])).toBe('Invalid file')
  })
})

describe('maxLevelOf', () => {
  const rows = (csv: string) =>
    parse(csv, { columns: true, skip_empty_lines: true, bom: true, cast: false }) as Array<Record<string, string>>

  it('finds the deepest level, with a BOM and leading-zero codes', () => {
    expect(maxLevelOf(rows('\uFEFFid,label,parent_id,level\n01,Food,,1\n011,Bread,01,2\n0111,Rye,011,3\n'))).toBe(3)
  })

  it('is null without usable levels', () => {
    expect(maxLevelOf(rows('id,label\n1,A\n'))).toBeNull()
    expect(maxLevelOf(rows('id,label,level\n1,A,x\n'))).toBeNull()
  })
})
