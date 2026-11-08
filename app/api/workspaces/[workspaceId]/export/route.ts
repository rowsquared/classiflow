import { NextResponse } from 'next/server'
import { reloadWorkspaceUser, workspaceRoute } from '@/lib/api-auth'
import { Prisma, SentenceStatus } from '@/lib/generated/prisma/client'
import { ExportColumnError, detailsStream, exportStream } from '@/lib/export-csv'
import { agreementStream, analysisScope, pairsStream, type AnalysisFilter } from '@/lib/export-double'
import { withWorkspace } from '@/lib/workspace/db'
import { audit } from '@/lib/audit'
import { zipStream } from '@/lib/zip'
import { logError } from '@/lib/logger'

/**
 * GET /api/workspaces/[workspaceId]/export?status=...&dateRange=...&labels=confirmed&formulaSafe=false
 * GET ...?format=details: double-annotation answers (each person's answer, one row each)
 * GET ...?format=pairs: double-annotation pairs (A and B side by side, match per level, final)
 * GET ...?format=agreement: double-annotation agreement summary (by level, pair, labeller; confusions)
 * GET ...?format=analysis: the three double-annotation files above in one ZIP
 *   Analysis filters: rounds=all|active|completed|cancelled, taxonomy=<key>,
 *   comparedFrom/comparedTo=YYYY-MM-DD, text=false (pairs without record text).
 * statusColumns=true|false: the records export's annotation status columns
 *   (default: only when the workspace ever used double annotation).
 *
 * Admins: every format. Supervisors: the double annotation formats (details,
 * pairs, agreement, analysis) for their team's records, without records they
 * labelled themselves (analysisScope); the records export stays admin only.
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
  ['admin', 'supervisor'],
  async (req, { user: actor }) => {
    try {
      const searchParams = req.nextUrl.searchParams
      const statusFilter = searchParams.get('status') || 'all'
      const dateRange = searchParams.get('dateRange') || 'all'
      const neutralizeFormulas = searchParams.get('formulaSafe') !== 'false'
      const labels = searchParams.get('labels') === 'confirmed' ? 'confirmed' : 'all'
      const format = searchParams.get('format') || 'records'
      if (!['records', 'details', 'pairs', 'agreement', 'analysis'].includes(format)) {
        return NextResponse.json({ error: `Unknown format "${format}"` }, { status: 400 })
      }
      if (format === 'records' && actor.role !== 'admin') {
        return NextResponse.json({ error: 'Only admins can export records' }, { status: 403 })
      }
      const statusColumnsParam = searchParams.get('statusColumns')
      const day = (value: string | null, end: boolean) => {
        if (!value) return null
        const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
        return Number.isNaN(date.getTime()) ? undefined : date
      }
      const rounds = searchParams.get('rounds') || 'all'
      const comparedFrom = day(searchParams.get('comparedFrom'), false)
      const comparedTo = day(searchParams.get('comparedTo'), true)
      if (
        !['all', 'active', 'completed', 'cancelled'].includes(rounds) ||
        comparedFrom === undefined ||
        comparedTo === undefined
      ) {
        return NextResponse.json({ error: 'Invalid analysis filter' }, { status: 400 })
      }
      const analysis: AnalysisFilter = {
        rounds: rounds as AnalysisFilter['rounds'],
        taxonomyKey: searchParams.get('taxonomy') || null,
        comparedFrom,
        comparedTo,
        includeText: searchParams.get('text') !== 'false'
      }

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
      const confirmed: Prisma.SentenceWhereInput =
        labels === 'confirmed'
          ? { AND: [where, { status: 'submitted', doubleRounds: { none: { status: 'active' } } }] }
          : where
      const team = await withWorkspace(actor.workspaceId, () => analysisScope(actor))
      const filter: Prisma.SentenceWhereInput = team ? { AND: [confirmed, team] } : confirmed

      // Each page is read in its own short transaction after re-checking that
      // the caller is still an admin of this workspace.
      const scope = {
        workspaceId: actor.workspaceId,
        stillAllowed: async () => {
          const role = (await reloadWorkspaceUser(actor.id, actor.workspaceId))?.role
          return role === 'admin' || (role === 'supervisor' && actor.role === 'supervisor' && format !== 'records')
        }
      }
      const entityId = format === 'records' ? 'records' : `double-annotation-${format}`
      const streamOpts = {
        neutralizeFormulas,
        onDone: (records: number) =>
          audit({
            workspaceId: actor.workspaceId,
            actorId: actor.id,
            action: 'export.downloaded',
            entityType: 'export',
            entityId,
            payload: { status: statusFilter, dateRange, labels, records, formulaSafe: neutralizeFormulas, rounds }
          })
      }
      // File names without ':' (not allowed in Windows file names, so a ZIP's
      // entries would not extract there): 2026-11-08T11-32-04Z.
      const stamp = `${actor.workspaceId}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}Z`
      if (format === 'analysis') {
        // One ZIP; each file is read (and audited) when its turn comes.
        const stream = zipStream([
          {
            name: `double-annotation-pairs-${stamp}.csv`,
            open: () => pairsStream(scope, filter, analysis, streamOpts)
          },
          { name: `double-annotation-answers-${stamp}.csv`, open: () => detailsStream(scope, filter, streamOpts) },
          {
            name: `double-annotation-agreement-${stamp}.csv`,
            open: () => agreementStream(scope, filter, analysis, streamOpts)
          }
        ])
        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="double-annotation-analysis-${stamp}.zip"`
          }
        })
      }
      const stream =
        format === 'details'
          ? await detailsStream(scope, filter, streamOpts)
          : format === 'pairs'
            ? await pairsStream(scope, filter, analysis, streamOpts)
            : format === 'agreement'
              ? await agreementStream(scope, filter, analysis, streamOpts)
              : await exportStream(scope, filter, {
                  ...streamOpts,
                  statusColumns: statusColumnsParam === null ? undefined : statusColumnsParam === 'true'
                })
      const fileName = {
        records: 'export',
        details: 'double-annotation-answers',
        pairs: 'double-annotation-pairs',
        agreement: 'double-annotation-agreement'
      }[format as 'records' | 'details' | 'pairs' | 'agreement']

      // Streamed: rows are read and sent in pages (lib/export-csv.ts), so large
      // exports do not build the whole file in memory.
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}-${stamp}.csv"`
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
