import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { launchJob } from '@/lib/ai-job-monitor'
import { AI_LABELING_BATCH_SIZE } from '@/lib/constants'
import { z } from 'zod'
import { audit } from '@/lib/audit'

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
    for (let i = 0; i < batches.length; i++) {
      const batchIds = batches[i]
      const job = await db().aILabelingJob.create({
        data: {
          workspaceId: user.workspaceId,
          createdById: user.id,
          taxonomyId: taxonomy.id,
          status: 'pending',
          totalSentences: batchIds.length,
          batchSize: AI_LABELING_BATCH_SIZE,
          filterCriteria: { sentenceIds: batchIds }
        },
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      })

      jobs.push(job)

      // Fire-and-forget: launch the monitor which will send to external API and poll
      afterCommit(() => launchJob(job.id, user.workspaceId))
    }

    console.log(
      `✅ Created ${jobs.length} AI labeling job(s) for taxonomy ${taxonomy.key} ` +
      `(${allSentenceIds.length} sentences in batches of ${AI_LABELING_BATCH_SIZE})`
    )

    await audit({
      actorId: user.id, action: 'ai.labeling_started', entityType: 'taxonomy', entityId: taxonomy.id,
      payload: { key: taxonomy.key, jobs: jobs.length, records: allSentenceIds.length },
    })
    return NextResponse.json({ ok: true, jobs, totalJobs: jobs.length })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to start AI labeling job'
    console.error('Failed to start AI labeling job:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})

export const GET = workspaceRoute(['admin'], async (req, { user }) => {
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
    console.error('Failed to fetch AI labeling jobs:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
