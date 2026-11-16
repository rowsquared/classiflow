/**
 * Reporting dates for the progress reports (lib/server/progress.ts).
 *
 * Users pick inclusive UTC dates. Queries use a half-open range ending at
 * midnight after the last day. Weeks start on Monday; partial weeks keep
 * their Monday as the bucket key.
 *
 * Pure functions (Intl only), shared by server and client.
 */

export type Granularity = 'day' | 'week'

/** Longest range a report accepts (two calendar years). */
export const MAX_RANGE_DAYS = 731
/** Most buckets one timeline returns; longer daily ranges must use weeks. */
export const MAX_BUCKETS = 366
/** Default range: the last seven reporting days, today included. */
export const DEFAULT_RANGE_DAYS = 7

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A calendar date as a UTC midnight Date (only its Y-M-D matter), or null when malformed or nonexistent. */
export function parseCalendarDate(value: string): Date | null {
  const match = DATE.exec(value)
  if (!match) return null
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** Whole calendar days from a to b. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** The Monday on or before `date`. */
export function mondayOf(date: Date): Date {
  return addDays(date, -((date.getUTCDay() + 6) % 7))
}

export const REPORTING_TIME_ZONE = 'UTC'

export function todayUtc(now = new Date()): Date {
  return parseCalendarDate(formatCalendarDate(now))!
}

export type ReportingRange = {
  /** Inclusive calendar dates, YYYY-MM-DD. */
  startDate: string
  endDate: string
  /** UTC instants: from <= t < to. */
  from: Date
  to: Date
  days: number
}

/**
 * Validates and normalizes inclusive dates. Missing dates default to the last
 * `days` (default seven) days ending today (UTC); a missing start with
 * an end means the `days` days ending then. "Last 30 days" is `{ days: 30 }`,
 * so a shared link keeps meaning the last 30 days.
 */
export function normalizeRange(
  input: { startDate?: string; endDate?: string; days?: number },
  now = new Date()
): { range: ReportingRange; error?: undefined } | { range?: undefined; error: string } {
  const end = input.endDate ? parseCalendarDate(input.endDate) : todayUtc(now)
  if (!end) return { error: 'endDate must be a date (YYYY-MM-DD)' }
  const start = input.startDate
    ? parseCalendarDate(input.startDate)
    : addDays(end, -((input.days ?? DEFAULT_RANGE_DAYS) - 1))
  if (!start) return { error: 'startDate must be a date (YYYY-MM-DD)' }
  if (start > end) return { error: 'startDate must not be after endDate' }
  const days = daysBetween(start, end) + 1
  if (days > MAX_RANGE_DAYS) return { error: `A report covers at most ${MAX_RANGE_DAYS} days` }
  return {
    range: {
      startDate: formatCalendarDate(start),
      endDate: formatCalendarDate(end),
      from: start,
      to: addDays(end, 1),
      days
    }
  }
}

export type Bucket = {
  /** Bucket key: the day, or the Monday of the week (may precede startDate). */
  key: string
  /** The part of the bucket inside the range, inclusive dates. */
  start: string
  end: string
}

/** Every bucket of the range in order, so empty days/weeks can be filled with zero. */
export function bucketsFor(
  range: Pick<ReportingRange, 'startDate' | 'endDate'>,
  granularity: Granularity
): { buckets: Bucket[]; error?: undefined } | { buckets?: undefined; error: string } {
  const start = parseCalendarDate(range.startDate)!
  const end = parseCalendarDate(range.endDate)!
  const buckets: Bucket[] = []
  if (granularity === 'day') {
    const days = daysBetween(start, end) + 1
    if (days > MAX_BUCKETS) return { error: `Daily timelines cover at most ${MAX_BUCKETS} days; use weeks` }
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const key = formatCalendarDate(day)
      buckets.push({ key, start: key, end: key })
    }
    return { buckets }
  }
  for (let monday = mondayOf(start); monday <= end; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6)
    buckets.push({
      key: formatCalendarDate(monday),
      start: formatCalendarDate(monday < start ? start : monday),
      end: formatCalendarDate(sunday > end ? end : sunday)
    })
  }
  if (buckets.length > MAX_BUCKETS) return { error: `A timeline has at most ${MAX_BUCKETS} buckets` }
  return { buckets }
}
