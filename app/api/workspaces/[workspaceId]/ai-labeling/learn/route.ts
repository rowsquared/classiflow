import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { scheduleAIJobs } from '@/lib/ai-job-monitor'
import { AI_UNAVAILABLE_MESSAGES, connectionForNewJobs, workspaceJobSettings } from '@/lib/ai-connections'
import { currentRequestId } from '@/lib/request-id'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { requestLogger } from '@/lib/logger'
import { lockLearningTaxonomy, selectLearningRecords } from '@/lib/server/ai-learning'

const learnSchema = z.object({
  taxonomyKey: z.string()
})
const MAX_RECORDS_PER_RUN = 50_000
const MAX_JOBS_PER_RUN = 100

export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  const parsed = learnSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Select a taxonomy to train' }, { status: 400 })
  const { taxonomyKey } = parsed.data

  const target = await db().taxonomy.findFirst({
    where: { workspaceId: scopeWorkspaceId(), key: taxonomyKey, isActive: true },
    select: { id: true }
  })
  if (!target) return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })

  const connection = await connectionForNewJobs()
  if ('unavailable' in connection) {
    return NextResponse.json(
      { error: AI_UNAVAILABLE_MESSAGES[connection.unavailable], code: connection.unavailable },
      { status: 409 }
    )
  }

  await lockLearningTaxonomy(target.id)
  const taxonomy = await db().taxonomy.findFirst({
    where: { id: target.id, isActive: true },
    select: {
      id: true,
      key: true,
      lastLearningAt: true,
      legacyLearningCutoff: true,
      lastLearningStatus: true,
      learningBacklog: true,
      newAnnotationsSinceLastLearning: true
    }
  })

  if (!taxonomy) {
    return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
  }

  if (
    await db().aILearningJob.count({ where: { taxonomyId: taxonomy.id, status: { in: ['pending', 'processing'] } } })
  ) {
    return NextResponse.json({ error: 'Learning is already running for this taxonomy' }, { status: 409 })
  }

  const { learningBatchSize: batchSize, learningMinNewAnnotations } = await workspaceJobSettings()
  if (
    taxonomy.lastLearningStatus !== 'failed' &&
    !taxonomy.learningBacklog &&
    taxonomy.newAnnotationsSinceLastLearning < learningMinNewAnnotations
  ) {
    return NextResponse.json(
      {
        error: `At least ${learningMinNewAnnotations} new annotations are required before training (currently ${taxonomy.newAnnotationsSinceLastLearning})`
      },
      { status: 400 }
    )
  }

  const selectionCutoff = new Date()
  const limit = Math.min(MAX_RECORDS_PER_RUN, MAX_JOBS_PER_RUN * batchSize)
  const candidates = await selectLearningRecords(taxonomy.id, taxonomy.legacyLearningCutoff, limit + 1)
  const records = candidates.slice(0, limit)
  if (records.length === 0) {
    return NextResponse.json({ error: 'No submitted annotations found for learning' }, { status: 400 })
  }
  const annotationCount = records.reduce((total, record) => total + record.annotations.length, 0)
  const learningRunId = randomUUID()
  const requestId = await currentRequestId()

  const jobs = []
  let remainingCredit = taxonomy.newAnnotationsSinceLastLearning
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const queuedAnnotationCount = Math.min(
      remainingCredit,
      batch.reduce((total, row) => total + row.annotations.length, 0)
    )
    remainingCredit -= queuedAnnotationCount
    const job = await db().aILearningJob.create({
      data: {
        workspaceId: user.workspaceId,
        createdById: user.id,
        taxonomyId: taxonomy.id,
        status: 'pending',
        totalSentences: batch.length,
        batchSize,
        connectionVersionId: connection.id,
        requestId,
        learningRunId,
        queuedAnnotationCount,
        ...(i === 0 ? { selectionCutoff } : {}),
        filterCriteria: { since: taxonomy.lastLearningAt?.toISOString() ?? null }
      },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    })

    await db().aILearningJobInput.createMany({
      data: batch.map(({ sentenceId, annotationIds, annotations }, position) => ({
        workspaceId: user.workspaceId,
        jobId: job.id,
        sentenceId,
        annotationIds,
        annotations,
        position
      }))
    })
    jobs.push(job)
  }
  afterCommit(scheduleAIJobs)

  await db().taxonomy.update({
    where: { id: taxonomy.id },
    data: {
      lastLearningStatus: 'processing',
      lastLearningError: null,
      learningBacklog: candidates.length > limit,
      lastLearningJobId: jobs[0]?.id || null
    }
  })

  ;(await requestLogger()).info(
    {
      jobs: jobs.length,
      taxonomy: taxonomy.key,
      records: records.length,
      annotations: annotationCount,
      batchSize
    },
    'Created AI learning jobs'
  )

  await audit({
    actorId: user.id,
    action: 'ai.learning_started',
    entityType: 'taxonomy',
    entityId: taxonomy.id,
    payload: { key: taxonomy.key, jobs: jobs.length, records: records.length }
  })
  return NextResponse.json({
    ok: true,
    jobs,
    totalJobs: jobs.length,
    totalSentences: records.length,
    totalAnnotations: annotationCount
  })
})
