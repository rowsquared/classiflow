import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery } from '@/lib/contracts/progress'
import { getProgressStats } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/stats?startDate=...&endDate=...
 *
 * Progress statistics for the records visible to the caller, compared with
 * the previous period of the same length.
 */
export const GET = workspaceRoute([], async (req, { user }) => {
  const range = parseQuery(dateRangeQuery, new URL(req.url).searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })
  return NextResponse.json(await getProgressStats(user, range.data))
})
