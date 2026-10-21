import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { getQueueStats } from '@/lib/server/sentences'

// Same filter parameters as GET .../sentences (queueWhere in lib/server/sentences.ts).
export const GET = workspaceRoute([], async (req, { user }) => {
  return NextResponse.json(await getQueueStats(user, new URL(req.url).searchParams))
})
