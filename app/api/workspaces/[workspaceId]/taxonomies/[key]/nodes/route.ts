import { NextResponse } from 'next/server'
import { db, scopeWorkspaceId } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import { Prisma } from '@/lib/generated/prisma/client'

export const GET = workspaceRoute([], async (req, { params: routeParams }) => {
  const { key } = routeParams
  const { searchParams } = new URL(req.url)
  const parentCodeRaw = searchParams.get('parentCode')
  const levelRaw = searchParams.get('level')
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500)
  const offset = parseInt(searchParams.get('offset') || '0', 10) || 0

  const taxonomy = await db().taxonomy.findUnique({
    where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } }
  })
  if (!taxonomy) return NextResponse.json({ error: 'taxonomy not found' }, { status: 404 })

  const where: Prisma.TaxonomyNodeWhereInput = { taxonomyId: taxonomy.id }
  if (parentCodeRaw !== null) {
    where.parentCode = parentCodeRaw === '' ? null : parentCodeRaw
  }
  if (levelRaw !== null) {
    where.level = Number(levelRaw)
  }
  if (q) {
    where.OR = [{ code: { startsWith: q, mode: 'insensitive' } }, { label: { contains: q, mode: 'insensitive' } }]
  }

  const [items, total] = await Promise.all([
    db().taxonomyNode.findMany({
      where,
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      skip: offset,
      take: limit,
      select: { code: true, label: true, level: true, parentCode: true, isLeaf: true, definition: true, examples: true }
    }),
    db().taxonomyNode.count({ where })
  ])

  return NextResponse.json({ items, total, limit, offset })
})
