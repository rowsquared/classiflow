import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { analysisScope, exportSummary } from '@/lib/export-double'

/**
 * GET /api/workspaces/[workspaceId]/export/summary
 * Counts for the export page: records, and double annotation rounds, pairs
 * (round x taxonomy) and compared pairs; for supervisors within their team's
 * analysis scope.
 */
export const GET = workspaceRoute(['admin', 'supervisor'], async (_req, { user }) => {
  return NextResponse.json({ ok: true, ...(await exportSummary(user.workspaceId, await analysisScope(user))) })
})
