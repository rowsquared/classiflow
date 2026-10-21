import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { listAIJobs } from '@/lib/server/ai-jobs'
import type { CaughtError } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const { error: authError } = await requireSession('admin')
    if (authError) return authError

    const searchParams = req.nextUrl.searchParams
    return NextResponse.json(await listAIJobs({
      statusParams: searchParams.getAll('status'),
      page: Math.max(parseInt(searchParams.get('page') || '1', 10), 1),
      limit: Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100),
    }))
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to fetch AI jobs:', error)
    return NextResponse.json({ 
      error: error?.message || 'Failed to fetch jobs',
      details: process.env.NODE_ENV === 'development' ? {
        code: error?.code,
        meta: error?.meta
      } : undefined
    }, { status: 500 })
  }
}
