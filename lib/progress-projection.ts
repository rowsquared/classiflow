import { addDays, daysBetween, formatCalendarDate, parseCalendarDate, todayIn } from '@/lib/reporting-dates'

export type CompletionProjection = {
  date: string | null
  status: 'complete' | 'projected' | 'no-pace' | 'too-distant'
  daysInPeriod: number
  completedInPeriod: number
  completedPerDay: number
}

/** A straight-line forecast from the selected window, starting at today's workload. */
export function projectCompletion(input: {
  remaining: number
  completedInPeriod: number
  startDate: string
  endDate: string
  timeZone: string
  now?: Date
}): CompletionProjection {
  const today = todayIn(input.timeZone, input.now)
  const start = parseCalendarDate(input.startDate)!
  const end = parseCalendarDate(input.endDate)!
  const periodEnd = end < today ? end : today
  const daysInPeriod = start <= periodEnd ? daysBetween(start, periodEnd) + 1 : 0
  const completedPerDay = daysInPeriod ? input.completedInPeriod / daysInPeriod : 0
  const base = {
    daysInPeriod,
    completedInPeriod: input.completedInPeriod,
    completedPerDay
  }
  if (input.remaining === 0) return { ...base, date: formatCalendarDate(today), status: 'complete' }
  if (!daysInPeriod || !input.completedInPeriod) return { ...base, date: null, status: 'no-pace' }
  const daysNeeded = Math.ceil(input.remaining / completedPerDay)
  if (daysNeeded > 3650) return { ...base, date: null, status: 'too-distant' }
  return { ...base, date: formatCalendarDate(addDays(today, daysNeeded)), status: 'projected' }
}
