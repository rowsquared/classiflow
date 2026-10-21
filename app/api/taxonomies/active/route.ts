import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { listActiveTaxonomies } from '@/lib/server/taxonomies'

export async function GET() {
  const { error } = await requireSession()
  if (error) return error

  try {
    return NextResponse.json(await listActiveTaxonomies())
  } catch (error) {
    console.error('Failed to fetch active taxonomies:', error)
    return NextResponse.json({ ok: false, error: 'Failed to load taxonomies' }, { status: 500 })
  }
}
