import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { scheduleAIJobs } from '@/lib/ai-job-monitor'
import { AI_UNAVAILABLE_MESSAGES, connectionForNewJobs } from '@/lib/ai-connections'
import { AI_LABELING_BATCH_SIZE } from '@/lib/constants'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { logError, requestLogger } from '@/lib/logger'

const startSchema = z.object({
  taxonomyKey: z.string(),
  sentenceIds: z.array(z.string()).optional(),
  importIds: z.array(z.string()).optional(),
  onlyUnsubmitted: z.boolean().optional()
})

const statusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])

function buildSentenceFilter(input: z.infer<typeof startSchema>) {
  const where: Record<string, unknown> = {}

  if (input.sentenceIds?.length) {
    where.id = { in: input.sentenceIds }
  }
  if (input.importIds?.length) {
    where.importId = { in: input.importIds }
  }
  if (input.onlyUnsubmitted) {
    where.status = 'pending'
  }

  return where
}

export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  try {
    const body = await req.json()
    const input = startSchema.parse(body)

    const taxonomy = await db().taxonomy.findFirst({
      where: { workspaceId: scopeWorkspaceId(), key: input.taxonomyKey, isActive: true },
      select: { id: true, key: true }
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

    // Resolve sentence IDs
    const sentenceWhere = buildSentenceFilter(input)
    const sentences = await db().sentence.findMany({
      where: sentenceWhere,
      select: { id: true },
      orderBy: [{ importOrder: 'asc' }, { id: 'asc' }]
    })

    const allSentenceIds = sentences.map(s => s.id)
    if (allSentenceIds.length === 0) {
      return NextResponse.json({ error: 'No sentences matched the criteria' }, { status: 400 })
    }

    // Split into batches
    const batches: string[][] = []
    for (let i = 0; i < allSentenceIds.length; i += AI_LABELING_BATCH_SIZE) {
      batches.push(allSentenceIds.slice(i, i + AI_LABELING_BATCH_SIZE))
    }

    // Create one job per batch and launch monitors
    const jobs = []
    for (const batchIds of batches) {
      const job = await db().aILabelingJob.create({
        data: {
          workspaceId: user.workspaceId,
          createdById: user.id,
          taxonomyId: taxonomy.id,
          status: 'pending',
          totalSentences: batchIds.length,
          batchSize: AI_LABELING_BATCH_SIZE,
          connectionVersionId: connection.id,
          // How the records were chosen; the records are the job's input rows.
          filterCriteria: {
            importIds: input.importIds ?? [],
            selectedRecords: input.sentenceIds?.length ?? 0,
            onlyUnsubmitted: input.onlyUnsubmitted ?? false
          }
        },
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      })

      await db().aILabelingJobInput.createMany({
        data: batchIds.map((sentenceId, position) => ({
          workspaceId: user.workspaceId,
          jobId: job.id,
          sentenceId,
          position
        }))
      })
      jobs.push(job)
    }

    // Queued; admitted up to the job ceilings once committed (lib/ai-job-monitor.ts).
    afterCommit(scheduleAIJobs)

    ;(await requestLogger()).info(
      { jobs: jobs.length, taxonomy: taxonomy.key, records: allSentenceIds.length, batchSize: AI_LABELING_BATCH_SIZE },
      'Created AI labeling jobs'
    )

    await audit({
      actorId: user.id,
      action: 'ai.labeling_started',
      entityType: 'taxonomy',
      entityId: taxonomy.id,
      payload: { key: taxonomy.key, jobs: jobs.length, records: allSentenceIds.length }
    })
    return NextResponse.json({ ok: true, jobs, totalJobs: jobs.length })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to start AI labeling job'
    await logError('Failed to start AI labeling job', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})

export const GET = workspaceRoute(['admin'], async req => {
  try {
    const searchParams = req.nextUrl.searchParams
    const statusParams = searchParams.getAll('status')
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)

    const where: Record<string, unknown> = {}
    if (statusParams.length > 0) {
      const validStatuses = statusParams.filter(s => statusSchema.safeParse(s).success)
      if (validStatuses.length > 0) {
        where.status = { in: validStatuses }
      }
    }

    const [jobs, total] = await Promise.all([
      db().aILabelingJob.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      }),
      db().aILabelingJob.count({ where })
    ])

    return NextResponse.json({
      ok: true,
      jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch jobs'
    await logError('Failed to fetch AI labeling jobs', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
