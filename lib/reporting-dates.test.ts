import { describe, expect, it } from 'vitest'
import {
  bucketsFor,
  MAX_BUCKETS,
  MAX_RANGE_DAYS,
  normalizeRange,
  parseCalendarDate,
  resolveTimeZone,
  startOfLocalDay,
  todayIn
} from './reporting-dates'

const day = (value: string) => parseCalendarDate(value)!

describe('parseCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(day('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(parseCalendarDate('2026-02-30')).toBeNull()
    expect(parseCalendarDate('2026-2-3')).toBeNull()
    expect(parseCalendarDate('yesterday')).toBeNull()
  })
})

describe('resolveTimeZone', () => {
  it('takes the first valid zone and falls back to UTC', () => {
    expect(resolveTimeZone(null, 'Europe/Berlin')).toBe('Europe/Berlin')
    expect(resolveTimeZone('Not/AZone', undefined)).toBe('UTC')
    expect(resolveTimeZone('Africa/Nairobi', 'Europe/Berlin')).toBe('Africa/Nairobi')
  })
})

describe('startOfLocalDay', () => {
  it('is UTC midnight in UTC', () => {
    expect(startOfLocalDay(day('2026-10-21'), 'UTC').toISOString()).toBe('2026-10-21T00:00:00.000Z')
  })

  it('applies the offset of the day, across DST changes', () => {
    // Berlin: CEST (UTC+2) until 25 October 2026, CET (UTC+1) after.
    expect(startOfLocalDay(day('2026-10-24'), 'Europe/Berlin').toISOString()).toBe('2026-10-23T22:00:00.000Z')
    expect(startOfLocalDay(day('2026-10-25'), 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(startOfLocalDay(day('2026-10-26'), 'Europe/Berlin').toISOString()).toBe('2026-10-25T23:00:00.000Z')
    // New York: EST to EDT on 8 March 2026.
    expect(startOfLocalDay(day('2026-03-08'), 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(startOfLocalDay(day('2026-03-09'), 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it('handles zones east of UTC with non-hour offsets', () => {
    expect(startOfLocalDay(day('2026-10-21'), 'Asia/Kolkata').toISOString()).toBe('2026-10-20T18:30:00.000Z')
  })

  it('takes the first instant of a day whose midnight is skipped', () => {
    // Santiago: clocks jump from 24:00 to 01:00 on 6 September 2026.
    const start = startOfLocalDay(day('2026-09-06'), 'America/Santiago')
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect(startOfLocalDay(day('2026-09-07'), 'America/Santiago').toISOString()).toBe('2026-09-07T03:00:00.000Z')
  })
})

describe('todayIn', () => {
  it('is the calendar date in the zone', () => {
    const now = new Date('2026-10-21T23:30:00Z')
    expect(todayIn('UTC', now).toISOString().slice(0, 10)).toBe('2026-10-21')
    expect(todayIn('Europe/Berlin', now).toISOString().slice(0, 10)).toBe('2026-10-22')
    expect(todayIn('America/New_York', now).toISOString().slice(0, 10)).toBe('2026-10-21')
  })
})

describe('normalizeRange', () => {
  it('makes the end date inclusive: up to midnight after it', () => {
    const { range } = normalizeRange({ startDate: '2026-10-01', endDate: '2026-10-07' }, 'UTC')
    expect(range).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-07', days: 7 })
    expect(range!.from.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(range!.to.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('converts local days in the reporting zone, a 25-hour day included', () => {
    const { range } = normalizeRange({ startDate: '2026-10-25', endDate: '2026-10-25' }, 'Europe/Berlin')
    expect(range!.from.toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(range!.to.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(range!.to.getTime() - range!.from.getTime()).toBe(25 * 3600_000)
  })

  it('defaults to the last seven days ending today in the zone', () => {
    const { range } = normalizeRange({}, 'Europe/Berlin', new Date('2026-10-21T23:30:00Z'))
    expect(range).toMatchObject({ startDate: '2026-10-16', endDate: '2026-10-22', days: 7 })
  })

  it('refuses malformed, reversed and oversized ranges', () => {
    expect(normalizeRange({ startDate: 'nope', endDate: '2026-10-07' }, 'UTC').error).toMatch(/startDate/)
    expect(normalizeRange({ startDate: '2026-10-01', endDate: '2026-13-01' }, 'UTC').error).toMatch(/endDate/)
    expect(normalizeRange({ startDate: '2026-10-08', endDate: '2026-10-07' }, 'UTC').error).toMatch(/after/)
    expect(normalizeRange({ startDate: '2024-01-01', endDate: '2026-01-01' }, 'UTC').error).toMatch(
      String(MAX_RANGE_DAYS)
    )
    expect(normalizeRange({ startDate: '2024-10-22', endDate: '2026-10-21' }, 'UTC').range?.days).toBe(730)
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
