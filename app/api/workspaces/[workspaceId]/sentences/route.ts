import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listQueue, queueFilterError } from '@/lib/server/sentences'

// GET /api/workspaces/[workspaceId]/sentences: one page of the queue.
export const GET = workspaceRoute([], async (req, { user }) => {
  const params = req.nextUrl.searchParams
  const error = queueFilterError(params)
  return error ? NextResponse.json({ error }, { status: 400 }) : NextResponse.json(await listQueue(user, params))
})
