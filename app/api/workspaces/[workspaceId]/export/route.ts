import { NextResponse } from 'next/server'
import { reloadWorkspaceUser, workspaceRoute } from '@/lib/api-auth'
import { Prisma, SentenceStatus } from '@/lib/generated/prisma/client'
import { exportStream } from '@/lib/export-csv'
import { audit } from '@/lib/audit'

/**
 * GET /api/workspaces/[workspaceId]/export?status=...&dateRange=...&formulaSafe=false
 *
 * Exports records with human labels, AI suggestions and comments; columns and
 * streaming in lib/export-csv.ts. Free-text cells that would run as
 * spreadsheet formulas get a leading apostrophe unless formulaSafe=false
 * (lib/csv.ts); ids and codes are never changed.
 */
export const GET = workspaceRoute(['admin'], async (req, { user: actor }) => {
  try {
    // Only admins can export
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

    // Each page is read in its own short transaction after re-checking that
    // the caller is still an admin of this workspace.
    const scope = {
      workspaceId: actor.workspaceId,
      stillAllowed: async () => (await reloadWorkspaceUser(actor.id, actor.workspaceId))?.role === 'admin',
    }
    const stream = await exportStream(scope, where, {
      neutralizeFormulas,
      onDone: (records: number) => audit({
        workspaceId: actor.workspaceId,
        actorId: actor.id, action: 'export.downloaded', entityType: 'export', entityId: 'records',
        payload: { status: statusFilter, dateRange, records, formulaSafe: neutralizeFormulas },
      }),
    })

    // Streamed: rows are read and sent in pages (lib/export-csv.ts), so large
    // exports do not build the whole file in memory.
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${actor.workspaceId}-${new Date().toISOString()}.csv"`
      }
    })

  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}, { transaction: false })

