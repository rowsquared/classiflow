import { workspaceRoute } from '@/lib/api-auth'
import { applyBulkLabels } from '@/lib/server/bulk-label'

export const POST = workspaceRoute([], async (req, { user }) => {
  return applyBulkLabels(user, await req.json().catch(() => null))
})
