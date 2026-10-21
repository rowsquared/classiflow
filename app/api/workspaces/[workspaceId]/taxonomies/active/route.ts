import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listActiveTaxonomies } from '@/lib/server/taxonomies'

export const GET = workspaceRoute([], async (_req, { user }) => {
  return NextResponse.json(await listActiveTaxonomies(user.workspaceId))
})
