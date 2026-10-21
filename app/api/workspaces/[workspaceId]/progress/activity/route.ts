import { NextResponse } from 'next/server'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { parseQuery, reportTimelineQuery } from '@/lib/contracts/progress'
import { getProgressActivity, ReportScopeError } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/activity?startDate=&endDate=&granularity=day|week&personId=&teamId=
 *
 * Distinct records labeled per day or (Monday) week in the reporting time
 * zone, every bucket present. At most 366 buckets: long ranges use weeks.
 */
export const GET = workspaceRoute([], async (req, { user }) => {
  const query = parseQuery(reportTimelineQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  try {
    const report = await getProgressActivity(user, query.data)
    if (report.error !== undefined) return NextResponse.json({ error: report.error }, { status: 400 })
    return NextResponse.json(report.data)
  } catch (caught) {
    if (caught instanceof ReportScopeError) return forbidden(caught.message)
    throw caught
  }
})
