import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { Prisma, SentenceStatus } from '@prisma/client'
import { exportStream } from '@/lib/export-csv'
import { audit } from '@/lib/audit'

/**
 * GET /api/export?status=...&dateRange=...&formulaSafe=false
 *
 * Exports records with human labels, AI suggestions and comments; columns and
 * streaming in lib/export-csv.ts. Free-text cells that would run as
 * spreadsheet formulas get a leading apostrophe unless formulaSafe=false
 * (lib/csv.ts); ids and codes are never changed.
 */
export async function GET(req: NextRequest) {
  try {
    // Only admins can export
    const { user: actor, error: authError } = await requireSession('admin')
    if (authError) return authError

    const searchParams = req.nextUrl.searchParams
    const statusFilter = searchParams.get('status') || 'all'
    const dateRange = searchParams.get('dateRange') || 'all'
    const neutralizeFormulas = searchParams.get('formulaSafe') !== 'false'

    // Build where clause
    const where: Prisma.SentenceWhereInput = {}

    if (statusFilter !== 'all') {
      if (!(Object.values(SentenceStatus) as string[]).includes(statusFilter)) {
        return NextResponse.json({ error: `Unknown status "${statusFilter}"` }, { status: 400 })
      }
      where.status = statusFilter as SentenceStatus
    }

    if (dateRange !== 'all') {
      const end = new Date()
      const start = new Date()

      switch (dateRange) {
        case 'today':
          start.setHours(0, 0, 0, 0)
          break
        case 'week':
          start.setDate(start.getDate() - 7)
          break
        case 'month':
          start.setDate(start.getDate() - 30)
          break
      }

      where.lastEditedAt = {
        gte: start,
        lte: end
      }
    }

    const stream = await exportStream(where, {
      neutralizeFormulas,
      onDone: records => audit({
        actorId: actor.id, action: 'export.downloaded', entityType: 'export', entityId: 'records',
        payload: { status: statusFilter, dateRange, records, formulaSafe: neutralizeFormulas },
      }),
    })

    // Streamed: rows are read and sent in pages (lib/export-csv.ts), so large
    // exports do not build the whole file in memory.
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${new Date().toISOString()}.csv"`
      }
    })

  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

