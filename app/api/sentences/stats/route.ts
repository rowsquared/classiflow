import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { getQueueStats } from '@/lib/server/sentences'
import type { CaughtError } from '@/lib/utils'

// Same filter parameters as GET /api/sentences (queueWhere in lib/server/sentences.ts).
export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireSession()
  if (authError) return authError

  try {
    return NextResponse.json(await getQueueStats(user, req.nextUrl.searchParams))
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to fetch sentence stats:', error)
    return NextResponse.json({ ok: false, error: 'Failed to load statistics' }, { status: 500 })
  }
}
