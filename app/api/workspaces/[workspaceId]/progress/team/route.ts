import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { dateRangeQuery, parseQuery } from '@/lib/contracts/progress'
import { getTeamProgress } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/team?startDate=...&endDate=...
 *
 * Team member performance (supervisors and admins only).
 */
export const GET = workspaceRoute(['supervisor', 'admin'], async (req, { user }) => {
  const range = parseQuery(dateRangeQuery, new URL(req.url).searchParams)
  if (range.error !== undefined) return NextResponse.json({ error: range.error }, { status: 400 })
  return NextResponse.json(await getTeamProgress(user, range.data))
})
