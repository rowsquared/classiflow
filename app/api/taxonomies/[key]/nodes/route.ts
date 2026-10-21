import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { Prisma } from '@prisma/client'

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { error } = await requireSession()
  if (error) return error

  const { key } = await params
  const { searchParams } = new URL(req.url)
  const parentCodeRaw = searchParams.get('parentCode')
  const levelRaw = searchParams.get('level')
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500)
  const offset = parseInt(searchParams.get('offset') || '0', 10) || 0

  const taxonomy = await prisma.taxonomy.findUnique({ where: { key } })
  if (!taxonomy) return NextResponse.json({ error: 'taxonomy not found' }, { status: 404 })

  const where: Prisma.TaxonomyNodeWhereInput = { taxonomyId: taxonomy.id }
  if (parentCodeRaw !== null) {
    where.parentCode = parentCodeRaw === '' ? null : parentCodeRaw
  }
  if (levelRaw !== null) {
    where.level = Number(levelRaw)
  }
  if (q) {
    where.OR = [
      { code: { startsWith: q, mode: 'insensitive' } },
      { label: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where,
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      skip: offset,
      take: limit,
      select: { code: true, label: true, level: true, parentCode: true, isLeaf: true, definition: true, examples: true },
    }),
    prisma.taxonomyNode.count({ where }),
  ])

  // Use stored isLeaf value, but recompute if null (fallback for legacy data)
  // A node is a leaf if:
  // 1. It's at maxDepth, OR
  // 2. It has no children
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      let computedIsLeaf = item.isLeaf
      
      // If isLeaf is null, compute it (fallback for legacy data or edge cases)
      if (computedIsLeaf === null) {
        // Check if at maxDepth
        if (item.level >= taxonomy.maxDepth) {
          computedIsLeaf = true
        } else {
          // Check if has children
          const childCount = await prisma.taxonomyNode.count({
            where: {
              taxonomyId: taxonomy.id,
              parentCode: item.code,
            }
          })
          computedIsLeaf = childCount === 0
        }
      }
      
      return { ...item, isLeaf: computedIsLeaf }
    })
  )

  return NextResponse.json({ items: enrichedItems, total, limit, offset })
}


