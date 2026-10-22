import { NextResponse } from 'next/server'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { parseQuery, reportMembersQuery } from '@/lib/contracts/progress'
import { ReportScopeError, searchReportMembers } from '@/lib/server/progress'

/**
 * GET /api/workspaces/[workspaceId]/progress/members?q=&kind=team|person&teamId=&userId=&limit=
 *
 * The Progress page's team and person pickers: members in the caller's scope
 * whose name or username matches, at most `limit` (20 by default) with
 * `more` when there are others. Supervisors and admins only.
 */
export const GET = workspaceRoute(['supervisor', 'admin'], async (req, { user }) => {
  const query = parseQuery(reportMembersQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  try {
    return NextResponse.json(await searchReportMembers(user, query.data))
  } catch (caught) {
    if (caught instanceof ReportScopeError) return forbidden(caught.message)
    throw caught
  }
})
