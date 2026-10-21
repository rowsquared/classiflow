import 'server-only'
import { prisma } from '@/lib/prisma'

// Taxonomy data for the admin page (app/admin/taxonomy), the queue page and
// /api/taxonomies. Taxonomies are visible to every signed-in user.

/** Every taxonomy with node counts per level and its AI sync/learning state. */
export async function listTaxonomiesWithStats() {
  const taxonomies = await prisma.taxonomy.findMany({
    where: {},
    include: {
      _count: {
        select: { 
          nodes: true,
          annotations: true
        }
      }
    },
    orderBy: [
      { createdAt: 'desc' }
    ]
  })

  // Add computed statistics
  const taxonomiesWithStats = await Promise.all(
    taxonomies.map(async (taxonomy) => {
      // Get actual max level from nodes
      const maxLevelNode = await prisma.taxonomyNode.findFirst({
        where: { taxonomyId: taxonomy.id },
        orderBy: { level: 'desc' },
        select: { level: true }
      })

      // Get node count per level
      const nodeCounts = await prisma.taxonomyNode.groupBy({
        by: ['level'],
        where: { taxonomyId: taxonomy.id },
        _count: true,
        orderBy: { level: 'asc' }
      })

      const levelCounts = nodeCounts.map(lc => ({
        level: lc.level,
        count: lc._count,
        name: taxonomy.levelNames 
          ? (taxonomy.levelNames as Record<string, string>)[lc.level.toString()] || `Level ${lc.level}`
          : `Level ${lc.level}`
      }))

      return {
        ...taxonomy,
        nodeCount: taxonomy._count.nodes,
        annotationCount: taxonomy._count.annotations,
        actualMaxLevel: maxLevelNode?.level || 0,
        levelCounts,
        _count: undefined
      }
    })
  )

  return {
    ok: true as const,
    learningThreshold: parseInt(process.env.AI_LEARNING_MIN_NEW_ANNOTATIONS || '500', 10),
    taxonomies: taxonomiesWithStats,
  }
}

/** What the labelling screens need to know about each taxonomy. */
export async function listActiveTaxonomies() {
  const taxonomies = await prisma.taxonomy.findMany({
    where: {},
    select: {
      id: true,
      key: true,
      maxDepth: true,
      levelNames: true,
      lastAISyncStatus: true
    },
    orderBy: { createdAt: 'asc' }
  })
  return { ok: true as const, taxonomies }
}
