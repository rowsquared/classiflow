import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery } from '@/lib/contracts/progress'
import { getTeamProgress } from '@/lib/server/progress'

/**
 * GET /api/progress/team?startDate=...&endDate=...
 *
 * Team member performance (supervisors and admins only).
 */
export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireSession('supervisor', 'admin')
  if (authError) return authError

  const range = parseQuery(dateRangeQuery, req.nextUrl.searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })

  try {
    return NextResponse.json(await getTeamProgress(user, range.data))
  } catch (error) {
    console.error('Team stats error:', error)
    return NextResponse.json({ error: 'Failed to load team statistics' }, { status: 500 })
  }
}
