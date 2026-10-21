import { formatCalendarDate, parseCalendarDate, todayIn } from '@/lib/reporting-dates'

const number = new Intl.NumberFormat('en-GB')
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const formatNumber = (value: number) => number.format(value)

/** "1 Oct 2026" for a YYYY-MM-DD calendar date. */
export function formatDay(date: string): string {
  const parsed = parseCalendarDate(date)
  return parsed ? dayFormat.format(parsed) : date
}

/** "1 Oct" for a YYYY-MM-DD calendar date (chart axis). */
export function formatShortDay(date: string): string {
  const parsed = parseCalendarDate(date)
  return parsed ? shortDayFormat.format(parsed) : date
}

/** "1 Oct 2026 – 7 Oct 2026", or one day. */
export function formatRange(startDate: string, endDate: string): string {
  return startDate === endDate ? formatDay(startDate) : `${formatDay(startDate)} – ${formatDay(endDate)}`
}

/** The calendar date of an instant in the reporting time zone. */
export function localDate(instant: string, timeZone: string): string {
  return formatCalendarDate(todayIn(timeZone, new Date(instant)))
}

/** "14:32" in the viewer's own clock. */
export function formatTime(instant: number | string): string {
  return new Date(instant).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Share as a whole percentage; null for a zero denominator. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** "3 days ago" style, for last seen. */
export function relativeTime(instant: string | null, now = Date.now()): string {
  if (!instant) return 'Never'
  const minutes = Math.round((now - new Date(instant).getTime()) / 60_000)
  if (minutes < 5) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}
