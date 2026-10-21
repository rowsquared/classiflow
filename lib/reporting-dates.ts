/**
 * Reporting dates for the progress reports (lib/server/progress.ts).
 *
 * Users pick inclusive calendar dates ("1 to 7 October"). In the workspace's
 * reporting time zone that means [local midnight of the first day, local
 * midnight after the last day), converted to UTC instants for the queries.
 * Days are calendar days, not 24-hour steps, so a range across a DST change
 * still has whole days. Weeks start on Monday; a week that the range cuts is
 * clipped to the range, and its bucket is still keyed by its Monday (the same
 * key PostgreSQL's date_trunc('week', ...) gives).
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

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The zone to use: the workspace's, else the deployment default, else UTC. Invalid names fall through. */
export function resolveTimeZone(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (candidate && isValidTimeZone(candidate)) return candidate
  }
  return 'UTC'
}

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

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** The wall-clock time in `timeZone` at `instant`, read as if it were UTC. */
function wallClock(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000
  return wallClock(whole, timeZone) - whole
}

/**
 * The UTC instant of local midnight at the start of `date` in `timeZone`.
 * Where a zone skips midnight (DST starting at 00:00), the first local
 * instant of that day.
 */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const local = date.getTime()
  // The zone's offset just before and just after this day; a DST change on
  // the day itself makes them differ. Each gives one candidate instant.
  const candidates = [local - offsetAt(local - 86_400_000, timeZone), local - offsetAt(local + 86_400_000, timeZone)]
  // Midnight that exists (twice, when clocks fall back across it: the first).
  const exact = candidates.filter(c => wallClock(c, timeZone) === local)
  if (exact.length > 0) return new Date(Math.min(...exact))
  // Midnight skipped (clocks jumped forward across it): the first instant of
  // the day is the moment of the jump, which the earlier offset gives.
  return new Date(Math.min(...candidates.filter(c => wallClock(c, timeZone) > local)))
}

/** Today's calendar date in `timeZone`. */
export function todayIn(timeZone: string, now = new Date()): Date {
  const wall = new Date(wallClock(now.getTime(), timeZone))
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
}

export type ReportingRange = {
  /** Inclusive calendar dates, YYYY-MM-DD. */
  startDate: string
  endDate: string
  timeZone: string
  /** UTC instants: from <= t < to. */
  from: Date
  to: Date
  days: number
}

/**
 * Validates and normalizes inclusive dates. Missing dates default to the last
 * `days` (default seven) days ending today in the zone; a missing start with
 * an end means the `days` days ending then. "Last 30 days" is `{ days: 30 }`,
 * so a shared link keeps meaning the last 30 days.
 */
export function normalizeRange(
  input: { startDate?: string; endDate?: string; days?: number },
  timeZone: string,
  now = new Date()
): { range: ReportingRange; error?: undefined } | { range?: undefined; error: string } {
  const end = input.endDate ? parseCalendarDate(input.endDate) : todayIn(timeZone, now)
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
      timeZone,
      from: startOfLocalDay(start, timeZone),
      to: startOfLocalDay(addDays(end, 1), timeZone),
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
