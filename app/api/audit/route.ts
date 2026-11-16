import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { listAudit } from '@/lib/audit'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  try {
    return NextResponse.json(await listAudit(null, req.nextUrl.searchParams))
  } catch (caught) {
    await logError('Could not read platform audit log', caught)
    return NextResponse.json({ error: 'Could not read audit log' }, { status: 500 })
  }
}
