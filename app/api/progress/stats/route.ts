import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery } from '@/lib/contracts/progress'
import { getProgressStats } from '@/lib/server/progress'

/**
 * GET /api/progress/stats?startDate=...&endDate=...
 *
 * Progress statistics for the records visible to the caller, compared with
 * the previous period of the same length.
 */
export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireSession()
  if (authError) return authError

  const range = parseQuery(dateRangeQuery, req.nextUrl.searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })

  try {
    return NextResponse.json(await getProgressStats(user, range.data))
  } catch (error) {
    console.error('Progress stats error:', error)
    return NextResponse.json({ error: 'Failed to load progress statistics' }, { status: 500 })
  }
}
