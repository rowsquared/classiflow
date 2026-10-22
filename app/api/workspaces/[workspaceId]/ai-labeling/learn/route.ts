import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { scheduleAIJobs } from '@/lib/ai-job-monitor'
import { AI_UNAVAILABLE_MESSAGES, connectionForNewJobs, workspaceJobSettings } from '@/lib/ai-connections'
import { currentRequestId } from '@/lib/request-id'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { logError, requestLogger } from '@/lib/logger'

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

    const connection = await connectionForNewJobs()
    if ('unavailable' in connection) {
      return NextResponse.json(
        { error: AI_UNAVAILABLE_MESSAGES[connection.unavailable], code: connection.unavailable },
        { status: 409 }
      )
    }

    const { learningBatchSize: batchSize, learningMinNewAnnotations } = await workspaceJobSettings()
    if (taxonomy.newAnnotationsSinceLastLearning < learningMinNewAnnotations) {
      return NextResponse.json(
        {
          error: `At least ${learningMinNewAnnotations} new annotations are required before training (currently ${taxonomy.newAnnotationsSinceLastLearning})`
        },
        { status: 400 }
      )
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
    const requestId = await currentRequestId()
    for (let i = 0; i < allSentenceIds.length; i += batchSize) {
      batches.push(allSentenceIds.slice(i, i + batchSize))
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
          batchSize,
          connectionVersionId: connection.id,
          requestId,
          filterCriteria: { since: taxonomy.lastLearningAt?.toISOString() ?? null }
        },
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      })

      await db().aILearningJobInput.createMany({
        data: batchIds.map((sentenceId, position) => ({
          workspaceId: user.workspaceId,
          jobId: job.id,
          sentenceId,
          position
        }))
      })
      jobs.push(job)
    }
    afterCommit(scheduleAIJobs)

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

    ;(await requestLogger()).info(
      {
        jobs: jobs.length,
        taxonomy: taxonomy.key,
        records: allSentenceIds.length,
        annotations: annotations.length,
        batchSize
      },
      'Created AI learning jobs'
    )

    await audit({
      actorId: user.id,
      action: 'ai.learning_started',
      entityType: 'taxonomy',
      entityId: taxonomy.id,
      payload: { key: taxonomy.key, jobs: jobs.length, records: allSentenceIds.length }
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
    await logError('Failed to start AI learning', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
