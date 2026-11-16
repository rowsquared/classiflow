import { describe, expect, it } from 'vitest'
import { bucketsFor, MAX_BUCKETS, MAX_RANGE_DAYS, normalizeRange, parseCalendarDate, todayUtc } from './reporting-dates'

const day = (value: string) => parseCalendarDate(value)!

describe('parseCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(day('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(parseCalendarDate('2026-02-30')).toBeNull()
    expect(parseCalendarDate('2026-2-3')).toBeNull()
    expect(parseCalendarDate('yesterday')).toBeNull()
  })
})

describe('normalizeRange', () => {
  it('makes the end date inclusive: up to midnight after it', () => {
    const { range } = normalizeRange({ startDate: '2026-10-01', endDate: '2026-10-07' })
    expect(range).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-07', days: 7 })
    expect(range!.from.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(range!.to.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('defaults to the last seven days ending today in UTC', () => {
    const { range } = normalizeRange({}, new Date('2026-10-21T23:30:00Z'))
    expect(range).toMatchObject({ startDate: '2026-10-15', endDate: '2026-10-21', days: 7 })
    expect(todayUtc(new Date('2026-10-21T23:30:00Z'))).toEqual(day('2026-10-21'))
  })

  it('takes a number of days ending today (or the end date) instead of a start', () => {
    const now = new Date('2026-10-21T12:00:00Z')
    expect(normalizeRange({ days: 30 }, now).range).toMatchObject({
      startDate: '2026-09-22',
      endDate: '2026-10-21',
      days: 30
    })
    expect(normalizeRange({ days: 1, endDate: '2026-03-01' }, now).range).toMatchObject({
      startDate: '2026-03-01',
      endDate: '2026-03-01'
    })
    // An explicit start wins over days.
    expect(normalizeRange({ startDate: '2026-10-20', days: 30 }, now).range?.days).toBe(2)
  })

  it('refuses malformed, reversed and oversized ranges', () => {
    expect(normalizeRange({ startDate: 'nope', endDate: '2026-10-07' }).error).toMatch(/startDate/)
    expect(normalizeRange({ startDate: '2026-10-01', endDate: '2026-13-01' }).error).toMatch(/endDate/)
    expect(normalizeRange({ startDate: '2026-10-08', endDate: '2026-10-07' }).error).toMatch(/after/)
    expect(normalizeRange({ startDate: '2024-01-01', endDate: '2026-01-01' }).error).toMatch(String(MAX_RANGE_DAYS))
    expect(normalizeRange({ startDate: '2024-10-22', endDate: '2026-10-21' }).range?.days).toBe(730)
  })
})

describe('bucketsFor', () => {
  it('has one bucket per day, gaps included', () => {
    const { buckets } = bucketsFor({ startDate: '2026-10-30', endDate: '2026-11-02' }, 'day')
    expect(buckets!.map(b => b.key)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('keys weeks by their Monday and clips partial edge weeks to the range', () => {
    // Thursday 1 October to Tuesday 13 October 2026.
    const { buckets } = bucketsFor({ startDate: '2026-10-01', endDate: '2026-10-13' }, 'week')
    expect(buckets).toEqual([
      { key: '2026-09-28', start: '2026-10-01', end: '2026-10-04' },
      { key: '2026-10-05', start: '2026-10-05', end: '2026-10-11' },
      { key: '2026-10-12', start: '2026-10-12', end: '2026-10-13' }
    ])
  })

  it('starts a week on Monday even when the range starts on Sunday', () => {
    const { buckets } = bucketsFor({ startDate: '2026-10-04', endDate: '2026-10-05' }, 'week')
    expect(buckets!.map(b => b.key)).toEqual(['2026-09-28', '2026-10-05'])
  })

  it('limits daily timelines to a year; weeks cover two', () => {
    expect(bucketsFor({ startDate: '2025-01-01', endDate: '2026-01-02' }, 'day').error).toMatch(String(MAX_BUCKETS))
    expect(bucketsFor({ startDate: '2025-01-01', endDate: '2026-01-01' }, 'day').buckets).toHaveLength(366)
    expect(bucketsFor({ startDate: '2024-10-22', endDate: '2026-10-21' }, 'week').buckets!.length).toBeLessThan(110)
  })
})
