import { workspaceRoute } from '@/lib/api-auth'
import { MEMBER_IMPORT_TEMPLATE } from '@/lib/member-import'

// GET: the member import template (headers and three example rows).
export const GET = workspaceRoute(
  ['admin'],
  async () =>
    new Response(MEMBER_IMPORT_TEMPLATE, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="member-import-template.csv"'
      }
    }),
  { transaction: false }
)
