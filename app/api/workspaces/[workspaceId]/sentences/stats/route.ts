import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { getQueueStats, queueFilterError } from '@/lib/server/sentences'

// Same filter parameters as GET .../sentences (queueWhere in lib/server/sentences.ts).
export const GET = workspaceRoute([], async (req, { user }) => {
  const params = req.nextUrl.searchParams
  const error = queueFilterError(params)
  return error ? NextResponse.json({ error }, { status: 400 }) : NextResponse.json(await getQueueStats(user, params))
})
