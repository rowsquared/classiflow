import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listAIJobs } from '@/lib/server/ai-jobs'

// GET /api/workspaces/[workspaceId]/ai-jobs?status=...&page=&limit=
export const GET = workspaceRoute(['admin'], async (req, { user }) => {
  const searchParams = new URL(req.url).searchParams
  return NextResponse.json(await listAIJobs(user.workspaceId, {
    statusParams: searchParams.getAll('status'),
    page: Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1),
    limit: Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100),
  }))
})
