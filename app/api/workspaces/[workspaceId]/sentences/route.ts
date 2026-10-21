import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listQueue } from '@/lib/server/sentences'

// GET /api/workspaces/[workspaceId]/sentences: one page of the queue.
export const GET = workspaceRoute([], async (req, { user }) => {
  return NextResponse.json(await listQueue(user, new URL(req.url).searchParams))
})
