import { NextResponse } from 'next/server'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { parseQuery, reportPeopleQuery } from '@/lib/contracts/progress'
import { getProgressPeople, ReportScopeError } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/people?startDate=&endDate=&personId=&teamId=&q=&sort=&dir=&page=&pageSize=
 *
 * One page (25 by default, at most 100) of the people in the caller's scope:
 * current workload by assignment and records labeled in the period by each
 * person. Supervisors and admins only; labellers have no staff directory.
 */
export const GET = workspaceRoute(['supervisor', 'admin'], async (req, { user }) => {
  const query = parseQuery(reportPeopleQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  try {
    const report = await getProgressPeople(user, query.data)
    if (report.error !== undefined) return NextResponse.json({ error: report.error }, { status: 400 })
    return NextResponse.json(report.data)
  } catch (caught) {
    if (caught instanceof ReportScopeError) return forbidden(caught.message)
    throw caught
  }
})
