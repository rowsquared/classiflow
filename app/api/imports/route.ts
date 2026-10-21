import { NextResponse } from 'next/server'
import { listImports } from '@/lib/server/imports'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'

export async function GET() {
  const { error } = await requireSession()
  if (error) return error

  try {
    return NextResponse.json(await listImports())
  } catch (caught) {
    const e = caught as CaughtError
    console.error('Failed to fetch imports:', e)
    return NextResponse.json({ 
      ok: false, 
      error: e?.message || String(e) 
    }, { status: 500 })
  }
}

