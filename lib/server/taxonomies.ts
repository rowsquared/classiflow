import 'server-only'
import { db } from '@/lib/workspace/db'
import { latestSyncByTaxonomy, NEVER_SYNCED } from '@/lib/server/ai-jobs'

// Taxonomy data for the admin page, the queue page and
// /api/workspaces/[workspaceId]/taxonomies. Every member of the workspace sees them.

/** Every taxonomy with node counts per level and its AI sync/learning state. */
export async function listTaxonomiesWithStats(workspaceId: string) {
  const taxonomies = await db().taxonomy.findMany({
    where: { workspaceId },
    include: {
      _count: {
        select: {
          nodes: true,
          annotations: true
        }
      }
    },
    orderBy: [{ createdAt: 'desc' }]
  })

  const syncs = await latestSyncByTaxonomy(taxonomies.map(t => t.id))

  // Add computed statistics
  const taxonomiesWithStats = await Promise.all(
    taxonomies.map(async taxonomy => {
      // Get actual max level from nodes
      const maxLevelNode = await db().taxonomyNode.findFirst({
        where: { taxonomyId: taxonomy.id },
        orderBy: { level: 'desc' },
        select: { level: true }
      })

      // Get node count per level
      const nodeCounts = await db().taxonomyNode.groupBy({
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
        ...(syncs.get(taxonomy.id) ?? NEVER_SYNCED),
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
    taxonomies: taxonomiesWithStats
  }
}

/** What the labelling screens need to know about each taxonomy. */
export async function listActiveTaxonomies(workspaceId: string) {
  const taxonomies = await db().taxonomy.findMany({
    where: { workspaceId },
    select: {
      id: true,
      key: true,
      maxDepth: true,
      levelNames: true
    },
    orderBy: { createdAt: 'asc' }
  })
  const syncs = await latestSyncByTaxonomy(taxonomies.map(t => t.id))
  return {
    ok: true as const,
    taxonomies: taxonomies.map(t => ({ ...t, lastAISyncStatus: syncs.get(t.id)?.lastAISyncStatus ?? null }))
  }
}
