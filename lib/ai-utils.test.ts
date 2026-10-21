import { describe, expect, it } from 'vitest'
import { buildFieldMap } from '@/lib/ai-utils'

describe('buildFieldMap', () => {
  it('uses mapped names and skips empty fields', () => {
    expect(
      buildFieldMap({ field1: 'Teacher', field2: null, field3: 'School', fieldMapping: { '1': 'job_title' } })
    ).toEqual({ job_title: 'Teacher', field3: 'School' })
  })

  it('falls back to fieldN when the stored mapping is not an object', () => {
    expect(buildFieldMap({ field1: 'Teacher', fieldMapping: 'oops' })).toEqual({ field1: 'Teacher' })
    expect(buildFieldMap({ field1: 'Teacher', fieldMapping: ['job_title'] })).toEqual({ field1: 'Teacher' })
  })
})
