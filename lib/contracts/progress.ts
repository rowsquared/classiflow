import { z } from 'zod'

// Query parameters of /api/progress/*, shared by the handlers and the page.

export type DateRange = { start: Date; end: Date }

const date = z.string({ error: 'startDate and endDate are required' })
  .transform(value => new Date(value))
  .refine(value => !Number.isNaN(value.getTime()), 'startDate and endDate must be valid dates')

export const dateRangeQuery = z
  .object({ startDate: date, endDate: date })
  .transform(({ startDate, endDate }): DateRange => ({ start: startDate, end: endDate }))

export const timelineQuery = z.object({
  granularity: z.enum(['day', 'week']).catch('day'),
})

/** Parses a query string; `error` is the first message, for a 400 response. */
export function parseQuery<S extends z.ZodType>(schema: S, params: URLSearchParams):
  { data: z.output<S>; error?: undefined } | { data?: undefined; error: string } {
  const result = schema.safeParse(Object.fromEntries(params))
  return result.success
    ? { data: result.data }
    : { error: result.error.issues[0]?.message ?? 'Invalid query' }
}
