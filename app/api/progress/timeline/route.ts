import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery, timelineQuery } from '@/lib/contracts/progress'
import { getProgressTimeline } from '@/lib/server/progress'

/**
 * GET /api/progress/timeline?startDate=...&endDate=...&granularity=day
 *
 * Daily (or weekly) activity for the charts.
 */
export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireSession()
  if (authError) return authError

  const range = parseQuery(dateRangeQuery, req.nextUrl.searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })
  const { granularity } = timelineQuery.parse(Object.fromEntries(req.nextUrl.searchParams))

  try {
    return NextResponse.json(await getProgressTimeline(user, range.data, granularity))
  } catch (error) {
    console.error('Progress timeline error:', error)
    return NextResponse.json({ error: 'Failed to load timeline' }, { status: 500 })
  }
}
