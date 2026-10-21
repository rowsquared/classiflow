import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { startAIJob, monitorAIJob } from '@/lib/ai-labeling'
import { AI_SOURCE_SLUG } from '@/lib/constants'
import type { CaughtError } from '@/lib/utils'
import { Prisma } from '@prisma/client'
import { audit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { user: actor, error: authError } = await requireSession('admin')
    if (authError) return authError

    const { key } = await params
    const taxonomy = await prisma.taxonomy.findUnique({
      where: { key },
      select: { id: true, key: true, description: true, maxDepth: true, levelNames: true }
    })

    if (!taxonomy) {
      return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
    }

    // Mark as processing immediately
    await prisma.taxonomy.update({
      where: { id: taxonomy.id },
      data: {
        lastAISyncStatus: 'processing',
        lastAISyncError: null
      }
    })

    const nodes = await prisma.taxonomyNode.findMany({
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

    const synonyms = await prisma.taxonomySynonym.findMany({
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

    const payload = {
      action: 'create',
      ...(AI_SOURCE_SLUG ? { sourceSlug: AI_SOURCE_SLUG } : {}),
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
          isLeaf: node.isLeaf ?? undefined
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
      await prisma.taxonomy.update({
        where: { id: taxonomy.id },
        data: {
          lastAISyncJobId: `failed-${Date.now()}`,
          lastAISyncAt: new Date(),
          lastAISyncStatus: 'failed',
          lastAISyncError: errorMessage
        }
      })
      throw error
    }

    // Job started — record the external job ID
    await prisma.taxonomy.update({
      where: { id: taxonomy.id },
      data: {
        lastAISyncJobId: jobId,
        lastAISyncAt: new Date(),
        lastAISyncStatus: 'processing',
        lastAISyncError: null
      }
    })

    // Monitor job asynchronously (fire-and-forget)
    monitorAIJob(jobId, `/taxonomies/${jobId}/status`, async (result) => {
      // Check if job was cancelled while monitoring
      const currentTaxonomy = await prisma.taxonomy.findUnique({
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
      await prisma.taxonomy.update({
        where: { id: taxonomy.id },
        data
      })
    })

    await audit({
      actorId: actor.id, action: 'taxonomy.ai_sync_started', entityType: 'taxonomy', entityId: taxonomy.id,
      payload: { key: taxonomy.key, jobId },
    })
    return NextResponse.json({ ok: true, jobId })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to sync taxonomy with AI:', error)
    return NextResponse.json({ error: error?.message || 'Failed to sync taxonomy' }, { status: 500 })
  }
}
