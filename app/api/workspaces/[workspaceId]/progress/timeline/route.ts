import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery, timelineQuery } from '@/lib/contracts/progress'
import { getProgressTimeline } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/timeline?startDate=...&endDate=...&granularity=day
 *
 * Daily (or weekly) activity for the charts.
 */
export const GET = workspaceRoute([], async (req, { user }) => {
  const searchParams = new URL(req.url).searchParams
  const range = parseQuery(dateRangeQuery, searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })
  const { granularity } = timelineQuery.parse(Object.fromEntries(searchParams))
  return NextResponse.json(await getProgressTimeline(user, range.data, granularity))
})
