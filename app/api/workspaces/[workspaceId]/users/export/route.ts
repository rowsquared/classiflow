import { workspaceRoute } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { memberExportCsv } from '@/lib/member-export'
import { membersForExport } from '@/lib/server/users'

// GET: every member of the workspace as CSV (workspace admins). Suspended
// members are included with their status; no secrets are exported.
export const GET = workspaceRoute(['admin'], async (_req, { user: actor }) => {
  const rows = await membersForExport(actor.workspaceId)
  await audit({
    actorId: actor.id,
    action: 'members.exported',
    entityType: 'workspace',
    entityId: actor.workspaceId,
    payload: { members: rows.length }
  })
  const date = new Date().toISOString().slice(0, 10)
  return new Response(memberExportCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="members-${actor.workspaceId}-${date}.csv"`,
      'Cache-Control': 'no-store'
    }
  })
})
