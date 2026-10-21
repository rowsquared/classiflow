import { createLoader, parseAsInteger, parseAsString, parseAsStringLiteral, type inferParserType } from 'nuqs/server'
import { PEOPLE_SORTS } from '@/lib/contracts/progress'
import { daysBetween, MAX_BUCKETS, parseCalendarDate } from '@/lib/reporting-dates'

// The Progress dashboard's view lives in the URL (nuqs), so back/forward and
// shared links reproduce it and the server page renders the same view the
// client then keeps up to date. Parameter names are the report API's
// (lib/contracts/progress.ts): a preset range is `days` (the last N days in
// the workspace's reporting time zone, so a shared link keeps meaning "the
// last 30 days"); a custom range is `startDate` + `endDate`.

export const RANGE_PRESETS = [7, 30, 90, 365] as const

export const progressParsers = {
  days: parseAsInteger.withDefault(7),
  startDate: parseAsString,
  endDate: parseAsString,
  personId: parseAsString,
  teamId: parseAsString,
  granularity: parseAsStringLiteral(['day', 'week'] as const).withDefault('day'),
  q: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(PEOPLE_SORTS).withDefault('name'),
  dir: parseAsStringLiteral(['asc', 'desc'] as const).withDefault('asc'),
  page: parseAsInteger.withDefault(1)
}

export type ProgressUrlState = inferParserType<typeof progressParsers>

/** Reads the dashboard state from a page's searchParams (server) or a URLSearchParams. */
export const loadProgressUrlState = createLoader(progressParsers)

/** A custom range needs both dates; otherwise the preset applies. */
export function isCustomRange(state: Pick<ProgressUrlState, 'startDate' | 'endDate'>): boolean {
  return !!state.startDate && !!state.endDate
}

/** Days in the selected range (custom ranges: inclusive dates; unparsable: the preset). */
export function rangeDays(state: Pick<ProgressUrlState, 'days' | 'startDate' | 'endDate'>): number {
  if (isCustomRange(state)) {
    const start = parseCalendarDate(state.startDate!)
    const end = parseCalendarDate(state.endDate!)
    if (start && end && start <= end) return daysBetween(start, end) + 1
  }
  return state.days
}

/** Daily buckets stop at MAX_BUCKETS days; longer ranges are shown by week. */
export function effectiveGranularity(state: ProgressUrlState): 'day' | 'week' {
  return state.granularity === 'day' && rangeDays(state) > MAX_BUCKETS ? 'week' : state.granularity
}

/** Who the dashboard reports on; data of one scope never stands in for another's. */
export function scopeKey(state: Pick<ProgressUrlState, 'personId' | 'teamId'>): string {
  return `${state.teamId ?? ''}|${state.personId ?? ''}`
}

function filterEntries(state: ProgressUrlState): Array<[string, string]> {
  const entries: Array<[string, string]> = isCustomRange(state)
    ? [
        ['startDate', state.startDate!],
        ['endDate', state.endDate!]
      ]
    : [['days', String(state.days)]]
  if (state.teamId) entries.push(['teamId', state.teamId])
  if (state.personId) entries.push(['personId', state.personId])
  return entries
}

const query = (entries: Array<[string, string]>) => new URLSearchParams(entries).toString()

/** Query string of /progress/overview for this view. */
export function overviewParams(state: ProgressUrlState): string {
  return query(filterEntries(state))
}

/** Query string of /progress/activity for this view. */
export function activityParams(state: ProgressUrlState): string {
  return query([...filterEntries(state), ['granularity', effectiveGranularity(state)]])
}

/** Query string of /progress/people for this view. */
export function peopleParams(state: ProgressUrlState): string {
  const entries = filterEntries(state)
  if (state.q.trim()) entries.push(['q', state.q.trim()])
  entries.push(['sort', state.sort], ['dir', state.dir], ['page', String(Math.max(1, state.page))])
  return query(entries)
}
