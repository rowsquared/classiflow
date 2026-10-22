import { NextResponse } from 'next/server'
import { reloadWorkspaceUser, workspaceRoute } from '@/lib/api-auth'
import { Prisma, SentenceStatus } from '@/lib/generated/prisma/client'
import { ExportColumnError, detailsStream, exportStream } from '@/lib/export-csv'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/logger'

/**
 * GET /api/workspaces/[workspaceId]/export?status=...&dateRange=...&labels=confirmed&formulaSafe=false
 * GET ...?format=details: double-annotation details (each person's answer)
 *
 * labels=confirmed keeps only records whose labels are confirmed: complete
 * ordinary work, and double annotation that agreed, was reviewed or accepted
 * as a single label. The default exports every record with its current labels.
 *
 * Exports records with human labels, AI suggestions and comments; columns and
 * streaming in lib/export-csv.ts. Free-text cells that would run as
 * spreadsheet formulas get a leading apostrophe unless formulaSafe=false
 * (lib/csv.ts); ids and codes are never changed.
 */
export const GET = workspaceRoute(
  ['admin'],
  async (req, { user: actor }) => {
    try {
      // Only admins can export
      const searchParams = req.nextUrl.searchParams
      const statusFilter = searchParams.get('status') || 'all'
      const dateRange = searchParams.get('dateRange') || 'all'
      const neutralizeFormulas = searchParams.get('formulaSafe') !== 'false'
      const labels = searchParams.get('labels') === 'confirmed' ? 'confirmed' : 'all'
      const details = searchParams.get('format') === 'details'

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

      // Confirmed: submitted (every required taxonomy confirmed) and no round still open.
      const filter: Prisma.SentenceWhereInput =
        labels === 'confirmed'
          ? { AND: [where, { status: 'submitted', doubleRounds: { none: { status: 'active' } } }] }
          : where

      // Each page is read in its own short transaction after re-checking that
      // the caller is still an admin of this workspace.
      const scope = {
        workspaceId: actor.workspaceId,
        stillAllowed: async () => (await reloadWorkspaceUser(actor.id, actor.workspaceId))?.role === 'admin'
      }
      const stream = await (details ? detailsStream : exportStream)(scope, filter, {
        neutralizeFormulas,
        onDone: (records: number) =>
          audit({
            workspaceId: actor.workspaceId,
            actorId: actor.id,
            action: 'export.downloaded',
            entityType: 'export',
            entityId: details ? 'double-annotation-details' : 'records',
            payload: { status: statusFilter, dateRange, labels, records, formulaSafe: neutralizeFormulas }
          })
      })

      // Streamed: rows are read and sent in pages (lib/export-csv.ts), so large
      // exports do not build the whole file in memory.
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${details ? 'double-annotation' : 'export'}-${actor.workspaceId}-${new Date().toISOString()}.csv"`
        }
      })
    } catch (error) {
      if (error instanceof ExportColumnError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      await logError('Export error', error)
      return NextResponse.json({ error: 'Export failed' }, { status: 500 })
    }
  },
  { transaction: false }
)
