import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { exportSummary } from '@/lib/export-double'

/**
 * GET /api/workspaces/[workspaceId]/export/summary
 * Counts for the export page (admins): records, and double annotation
 * rounds, pairs (round x taxonomy) and compared pairs.
 */
export const GET = workspaceRoute(['admin'], async (_req, { user }) => {
  return NextResponse.json({ ok: true, ...(await exportSummary(user.workspaceId)) })
})
