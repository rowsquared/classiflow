import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { listQueue } from '@/lib/server/sentences'
import type { CaughtError } from '@/lib/utils'

export async function GET(request: NextRequest) {
  const { user, error: authError } = await requireSession()
  if (authError) return authError

  try {
    return NextResponse.json(await listQueue(user, request.nextUrl.searchParams))
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Sentences API error:', error)
    return NextResponse.json({ error: 'Failed to load records' }, { status: 500 })
  }
}
