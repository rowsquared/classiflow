import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatFieldName, formatRelativeTime, parseEnum } from '@/lib/utils'

describe('formatFieldName', () => {
  it('converts snake_case to Title Case', () => {
    expect(formatFieldName('job_description')).toBe('Job Description')
  })
})

describe('formatRelativeTime', () => {
  it('handles null', () => {
    expect(formatRelativeTime(null)).toBe('Never')
  })

  it('formats hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })
})

describe('formatDate / formatDateTime', () => {
  it('formats a local date', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('rejects invalid input', () => {
    expect(formatDateTime('not a date')).toBe('Invalid date')
  })
})

describe('parseEnum', () => {
  const Status = { pending: 'pending', submitted: 'submitted' } as const

  it('accepts a known value', () => {
    expect(parseEnum(Status, 'submitted')).toBe('submitted')
  })

  it('rejects unknown, empty and missing values', () => {
    expect(parseEnum(Status, 'bogus')).toBeUndefined()
    expect(parseEnum(Status, '')).toBeUndefined()
    expect(parseEnum(Status, null)).toBeUndefined()
  })
})
