import { NextResponse } from 'next/server'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { parseQuery, reportFilterQuery } from '@/lib/contracts/progress'
import { getProgressOverview, ReportScopeError } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/overview?startDate=&endDate=&personId=&teamId=
 *
 * Workload now (total, complete, remaining by status) and distinct records
 * labeled in the period, for the caller's scope narrowed by person/team.
 * Dates are inclusive days in the workspace's reporting time zone.
 */
export const GET = workspaceRoute([], async (req, { user }) => {
  const query = parseQuery(reportFilterQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  try {
    const report = await getProgressOverview(user, query.data)
    if (report.error !== undefined) return NextResponse.json({ error: report.error }, { status: 400 })
    return NextResponse.json(report.data)
  } catch (caught) {
    if (caught instanceof ReportScopeError) return forbidden(caught.message)
    throw caught
  }
})
