import { addDays, daysBetween, formatCalendarDate, parseCalendarDate, todayIn } from '@/lib/reporting-dates'

export type CompletionProjection = {
  date: string | null
  status: 'complete' | 'projected' | 'no-pace' | 'no-net-progress' | 'too-distant'
  daysObserved: number
  completedInPeriod: number
  importedInPeriod: number
  completedPerDay: number
  importedPerDay: number
  netPerDay: number
}

/** A straight-line forecast from the selected window, starting at today's workload. */
export function projectCompletion(input: {
  remaining: number
  completedInPeriod: number
  importedInPeriod: number
  startDate: string
  endDate: string
  activityCoverageStart: string
  timeZone: string
  now?: Date
}): CompletionProjection {
  const today = todayIn(input.timeZone, input.now)
  const start = parseCalendarDate(input.startDate)!
  const end = parseCalendarDate(input.endDate)!
  const coverage = todayIn(input.timeZone, new Date(input.activityCoverageStart))
  const observedStart = start > coverage ? start : coverage
  const observedEnd = end < today ? end : today
  const daysObserved = observedStart <= observedEnd ? daysBetween(observedStart, observedEnd) + 1 : 0
  const completedPerDay = daysObserved ? input.completedInPeriod / daysObserved : 0
  const importedPerDay = daysObserved ? input.importedInPeriod / daysObserved : 0
  const netPerDay = completedPerDay - importedPerDay
  const base = {
    daysObserved,
    completedInPeriod: input.completedInPeriod,
    importedInPeriod: input.importedInPeriod,
    completedPerDay,
    importedPerDay,
    netPerDay
  }
  if (input.remaining === 0) return { ...base, date: formatCalendarDate(today), status: 'complete' }
  if (!daysObserved || !input.completedInPeriod) return { ...base, date: null, status: 'no-pace' }
  if (netPerDay <= 0) return { ...base, date: null, status: 'no-net-progress' }
  const daysNeeded = Math.ceil(input.remaining / netPerDay)
  if (daysNeeded > 3650) return { ...base, date: null, status: 'too-distant' }
  return { ...base, date: formatCalendarDate(addDays(today, daysNeeded)), status: 'projected' }
}
