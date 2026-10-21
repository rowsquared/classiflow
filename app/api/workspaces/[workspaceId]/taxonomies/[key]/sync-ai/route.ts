import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { db, withWorkspace } from '@/lib/workspace/db'
import { startAIJob, monitorAIJob } from '@/lib/ai-labeling'
import { aiSourceSlug } from '@/lib/constants'
import type { CaughtError } from '@/lib/utils'
import { Prisma } from '@/lib/generated/prisma/client'
import { audit } from '@/lib/audit'

// No request-wide transaction: the AI service is called in between, and its
// failure must still be recorded. Each database step is its own workspace
// transaction (writes refuse an archived workspace).
export const POST = workspaceRoute<'key'>(
  ['admin'],
  async (req, { user: actor, params: routeParams }) => {
    const workspaceId = actor.workspaceId
    const inWorkspace = <T>(fn: () => Promise<T>) => withWorkspace(workspaceId, fn, { write: true })
    try {
      const { key } = routeParams
      const loaded = await inWorkspace(async () => {
        const taxonomy = await db().taxonomy.findUnique({
          where: { workspaceId_key: { workspaceId, key } },
          select: { id: true, key: true, description: true, maxDepth: true, levelNames: true }
        })

        if (!taxonomy) return null

        // Mark as processing immediately
        await db().taxonomy.update({
          where: { id: taxonomy.id },
          data: {
            lastAISyncStatus: 'processing',
            lastAISyncError: null
          }
        })

        const nodes = await db().taxonomyNode.findMany({
          where: { taxonomyId: taxonomy.id },
          select: {
            code: true,
            level: true,
            label: true,
            definition: true,
            examples: true,
            parentCode: true,
            isLeaf: true
          },
          orderBy: [{ level: 'asc' }, { code: 'asc' }]
        })

        const synonyms = await db().taxonomySynonym.findMany({
          where: { taxonomyId: taxonomy.id },
          select: {
            synonym: true,
            node: {
              select: {
                code: true
              }
            }
          }
        })

        return { taxonomy, nodes, synonyms }
      })
      if (!loaded) {
        return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
      }
      const { taxonomy, nodes, synonyms } = loaded

      const payload = {
        action: 'create',
        sourceSlug: aiSourceSlug(workspaceId),
        taxonomy: {
          key: taxonomy.key,
          description: taxonomy.description ?? '',
          maxDepth: taxonomy.maxDepth,
          levelNames: taxonomy.levelNames ?? {},
          nodes: nodes.map(node => ({
            code: node.code,
            level: node.level,
            label: node.label,
            definition: node.definition ?? '',
            examples: node.examples ?? '',
            parentCode: node.parentCode,
            isLeaf: node.isLeaf
          })),
          synonyms: synonyms.map(s => ({
            nodeCode: s.node.code,
            synonym: s.synonym
          }))
        }
      }

      let jobId: string
      try {
        jobId = await startAIJob('/taxonomies', payload)
      } catch (caught) {
        const error = caught as CaughtError
        const errorMessage = error?.message || 'Failed to start AI sync job'
        await inWorkspace(() =>
          db().taxonomy.update({
            where: { id: taxonomy.id },
            data: {
              lastAISyncJobId: `failed-${Date.now()}`,
              lastAISyncAt: new Date(),
              lastAISyncStatus: 'failed',
              lastAISyncError: errorMessage
            }
          })
        )
        throw error
      }

      // Job started — record the external job ID
      await inWorkspace(() =>
        db().taxonomy.update({
          where: { id: taxonomy.id },
          data: {
            lastAISyncJobId: jobId,
            lastAISyncAt: new Date(),
            lastAISyncStatus: 'processing',
            lastAISyncError: null
          }
        })
      )

      // Monitor job asynchronously (fire-and-forget)
      monitorAIJob(jobId, `/taxonomies/${jobId}/status`, result =>
        inWorkspace(async () => {
          // Check if job was cancelled while monitoring
          const currentTaxonomy = await db().taxonomy.findUnique({
            where: { id: taxonomy.id },
            select: { lastAISyncStatus: true }
          })

          if (currentTaxonomy?.lastAISyncStatus === 'cancelled') {
            return
          }

          const data: Prisma.TaxonomyUpdateInput = result.success
            ? {
                lastAISyncStatus: 'completed',
                lastAISyncAt: new Date(),
                lastAISyncError: null
              }
            : {
                lastAISyncStatus: 'failed',
                lastAISyncAt: new Date(),
                lastAISyncError: result.error || result.data?.error || 'Unknown AI sync failure'
              }
          await db().taxonomy.update({
            where: { id: taxonomy.id },
            data
          })
        })
      )

      await audit({
        actorId: actor.id,
        action: 'taxonomy.ai_sync_started',
        entityType: 'taxonomy',
        entityId: taxonomy.id,
        payload: { key: taxonomy.key, jobId }
      })
      return NextResponse.json({ ok: true, jobId })
    } catch (caught) {
      const error = caught as CaughtError
      console.error('Failed to sync taxonomy with AI:', error)
      return NextResponse.json({ error: error?.message || 'Failed to sync taxonomy' }, { status: 500 })
    }
  },
  { transaction: false }
)
