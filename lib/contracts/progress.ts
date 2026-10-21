import { z } from 'zod'
import { MAX_RANGE_DAYS } from '@/lib/reporting-dates'

// Query parameters of /api/workspaces/[id]/progress/*, shared by the handlers and the page.

/** Parses a query string; `error` is the first message, for a 400 response. */
export function parseQuery<S extends z.ZodType>(
  schema: S,
  params: URLSearchParams
): { data: z.output<S>; error?: undefined } | { data?: undefined; error: string } {
  const result = schema.safeParse(Object.fromEntries(params))
  return result.success ? { data: result.data } : { error: result.error.issues[0]?.message ?? 'Invalid query' }
}

// ---------------------------------------------------------------------------
// Progress reports (overview, timeline, people): /api/workspaces/[id]/progress/*
// Dates are inclusive calendar days in the workspace's reporting time zone
// (lib/reporting-dates.ts); personId and teamId are user ids (teamId: the
// supervisor whose subtree to report on).
// ---------------------------------------------------------------------------

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD')
  .optional()
const selector = z.string().trim().min(1).max(100).optional()

export const reportFilterQuery = z.object({
  startDate: calendarDate,
  endDate: calendarDate,
  /** Without startDate: the last `days` days up to endDate (default today). */
  days: z.coerce
    .number({ error: 'days must be a number' })
    .int('days must be a whole number')
    .min(1, 'days must be at least 1')
    .max(MAX_RANGE_DAYS, `A report covers at most ${MAX_RANGE_DAYS} days`)
    .optional(),
  personId: selector,
  teamId: selector
})
export type ReportFilter = z.output<typeof reportFilterQuery>

export const reportTimelineQuery = reportFilterQuery.extend({
  granularity: z.enum(['day', 'week'], { error: 'granularity must be day or week' }).default('day')
})

export const PEOPLE_SORTS = ['name', 'role', 'assigned', 'complete', 'remaining', 'labeled', 'lastSeen'] as const
export type PeopleSort = (typeof PEOPLE_SORTS)[number]
export const PEOPLE_PAGE_SIZE = 25
export const PEOPLE_MAX_PAGE_SIZE = 100

export const reportPeopleQuery = reportFilterQuery.extend({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(PEOPLE_SORTS, { error: 'Unknown sort' }).default('name'),
  dir: z.enum(['asc', 'desc'], { error: 'dir must be asc or desc' }).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PEOPLE_MAX_PAGE_SIZE).default(PEOPLE_PAGE_SIZE)
})
export type PeopleQuery = z.output<typeof reportPeopleQuery>

/** What every report echoes back: the filters as applied. */
export type ReportMeta = {
  startDate: string
  endDate: string
  timeZone: string
  personId: string | null
  teamId: string | null
  generatedAt: string
  /** Activity history exists from here on; earlier days show no activity. */
  activityCoverageStart: string
}

export type ProgressOverview = ReportMeta & {
  workload: {
    total: number
    complete: number
    remaining: number
    /** Remaining split by status (pending + skipped + escalated = remaining). */
    pending: number
    skipped: number
    escalated: number
    flagged: number
  }
  activity: { labeledRecords: number }
}

export type ProgressTimeline = ReportMeta & {
  granularity: 'day' | 'week'
  buckets: Array<{ key: string; start: string; end: string; labeledRecords: number }>
}

export type ProgressPerson = {
  userId: string
  name: string
  username: string
  role: 'admin' | 'supervisor' | 'labeller'
  status: 'active' | 'suspended'
  lastSeenAt: string | null
  assigned: number
  complete: number
  remaining: number
  labeledRecords: number
}

export type ProgressPeople = ReportMeta & {
  people: ProgressPerson[]
  total: number
  page: number
  pageSize: number
  sort: PeopleSort
  dir: 'asc' | 'desc'
}
