import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { launchLearningJob } from '@/lib/ai-job-monitor'
import { AI_LEARNING_BATCH_SIZE, AI_LEARNING_MIN_NEW_ANNOTATIONS } from '@/lib/constants'
import { z } from 'zod'
import { audit } from '@/lib/audit'

const learnSchema = z.object({
  taxonomyKey: z.string()
})

export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  try {
    const body = await req.json()
    const { taxonomyKey } = learnSchema.parse(body)

    const taxonomy = await db().taxonomy.findFirst({
      where: { workspaceId: scopeWorkspaceId(), key: taxonomyKey, isActive: true },
      select: {
        id: true,
        key: true,
        lastLearningAt: true,
        newAnnotationsSinceLastLearning: true
      }
    })

    if (!taxonomy) {
      return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
    }

    if (taxonomy.newAnnotationsSinceLastLearning < AI_LEARNING_MIN_NEW_ANNOTATIONS) {
      return NextResponse.json({
        error: `At least ${AI_LEARNING_MIN_NEW_ANNOTATIONS} new annotations are required before training (currently ${taxonomy.newAnnotationsSinceLastLearning})`
      }, { status: 400 })
    }

    // Query submitted, user-created annotations since last learning run
    const annotationsWhere: Record<string, unknown> = {
      taxonomyId: taxonomy.id,
      source: 'user' as const,
      sentence: { status: 'submitted' }
    }

    if (taxonomy.lastLearningAt) {
      annotationsWhere.updatedAt = { gt: taxonomy.lastLearningAt }
    }

    const annotations = await db().sentenceAnnotation.findMany({
      where: annotationsWhere,
      select: {
        sentenceId: true,
        level: true,
        nodeCode: true
      }
    })

    if (annotations.length === 0) {
      return NextResponse.json({ error: 'No submitted annotations found for learning' }, { status: 400 })
    }

    // Collect unique sentence IDs
    const sentenceIdSet = new Set<string>()
    for (const ann of annotations) {
      sentenceIdSet.add(ann.sentenceId)
    }
    const allSentenceIds = Array.from(sentenceIdSet)

    // Split into batches
    const batches: string[][] = []
    for (let i = 0; i < allSentenceIds.length; i += AI_LEARNING_BATCH_SIZE) {
      batches.push(allSentenceIds.slice(i, i + AI_LEARNING_BATCH_SIZE))
    }

    // Create one job per batch and launch monitors
    const jobs = []
    for (const batchIds of batches) {
      const job = await db().aILearningJob.create({
        data: {
          workspaceId: user.workspaceId,
          createdById: user.id,
          taxonomyId: taxonomy.id,
          status: 'pending',
          totalSentences: batchIds.length,
          batchSize: AI_LEARNING_BATCH_SIZE,
          filterCriteria: { sentenceIds: batchIds }
        },
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      })

      jobs.push(job)
      afterCommit(() => launchLearningJob(job.id, user.workspaceId))
    }

    // Reset annotation counter and set status to processing
    await db().taxonomy.update({
      where: { id: taxonomy.id },
      data: {
        newAnnotationsSinceLastLearning: 0,
        lastLearningStatus: 'processing',
        lastLearningError: null,
        lastLearningJobId: jobs[0]?.id || null
      }
    })

    console.log(
      `✅ Created ${jobs.length} AI learning job(s) for taxonomy ${taxonomy.key} ` +
      `(${allSentenceIds.length} sentences with ${annotations.length} annotations, batches of ${AI_LEARNING_BATCH_SIZE})`
    )

    await audit({
      actorId: user.id, action: 'ai.learning_started', entityType: 'taxonomy', entityId: taxonomy.id,
      payload: { key: taxonomy.key, jobs: jobs.length, records: allSentenceIds.length },
    })
    return NextResponse.json({
      ok: true,
      jobs,
      totalJobs: jobs.length,
      totalSentences: allSentenceIds.length,
      totalAnnotations: annotations.length
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to start AI learning job'
    console.error('AI learning error:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
