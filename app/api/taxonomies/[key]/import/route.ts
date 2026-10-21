import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { createTaxonomyNodes } from '@/lib/taxonomy-nodes'
import { MAX_UPLOAD_BYTES } from '@/lib/upload'

/**
 * Incremental import: ADDS nodes to an existing taxonomy (body = text/csv).
 * New rows may hang under nodes already in the taxonomy; existing codes cannot
 * be changed here (replace the whole taxonomy with PUT /api/taxonomies/[key]).
 * ?dryRun=true (default) only validates; the commit runs the same parser.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { error } = await requireSession('admin')
  if (error) return error

  const { key } = await params
  const taxonomy = await prisma.taxonomy.findUnique({ where: { key } })
  if (!taxonomy) {
    return NextResponse.json({ error: 'taxonomy not found' }, { status: 404 })
  }

  const rawDry = (req.nextUrl.searchParams.get('dryRun') ?? 'true').toLowerCase()
  const dryRun = ['1', 'true', 'yes'].includes(rawDry)

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('text/csv')) {
    return NextResponse.json({ error: 'Content-Type must be text/csv' }, { status: 400 })
  }
  const csv = await req.text()
  if (csv.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File is too large' }, { status: 400 })
  }

  const existing = await prisma.taxonomyNode.findMany({
    where: { taxonomyId: taxonomy.id },
    select: { code: true, level: true }
  })
  const { nodes, errors } = parseTaxonomyCsv(csv, {
    maxDepth: taxonomy.maxDepth,
    existingNodes: new Map(existing.map(n => [n.code, n.level]))
  })
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, error: formatCsvErrors(errors), errors }, { status: 400 })
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count: nodes.length })
  }

  try {
    await prisma.$transaction(async (tx) => {
      await createTaxonomyNodes(tx, taxonomy.id, nodes)
      // Existing nodes that just gained children are no longer leaves.
      const newParents = Array.from(new Set(nodes.map(n => n.parentCode).filter((c): c is string => !!c)))
      if (newParents.length > 0) {
        await tx.taxonomyNode.updateMany({
          where: { taxonomyId: taxonomy.id, code: { in: newParents } },
          data: { isLeaf: false }
        })
      }
    }, { timeout: 120_000 })
  } catch (caught) {
    console.error('Taxonomy incremental import failed:', caught)
    return NextResponse.json({ ok: false, error: 'Import failed; nothing was imported' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, dryRun: false, count: nodes.length })
}
