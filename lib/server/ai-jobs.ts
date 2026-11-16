import 'server-only'
import { afterCommit, db } from '@/lib/workspace/db'
import { cancelExternalJob, scheduleAIJobs, type JobKind } from '@/lib/ai-job-monitor'
import { lockLearningTaxonomy, settleLearningRun } from '@/lib/server/ai-learning'
import { currentRequestId } from '@/lib/request-id'
import type { AILabelingJobStatus } from '@/lib/generated/prisma/client'
import { z } from 'zod'

// AI jobs of one workspace for its admin page, the job badge and
// /api/workspaces/[workspaceId]/ai-jobs. Admins only; the caller checks the
// role. Call inside the workspace's transaction.

const statusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])
const ALL_STATUSES = statusSchema.options

export type AIJobType = 'labeling' | 'learning' | 'taxonomy_sync'

export const JOB_KIND: Record<AIJobType, JobKind> = {
  labeling: 'labeling',
  learning: 'learning',
  taxonomy_sync: 'sync'
}

export type AIJobListQuery = { statusParams: string[]; page: number; limit: number }

const createdBy = { select: { id: true, name: true, email: true } } as const

type JobRow = {
  id: string
  status: AILabelingJobStatus
  startedAt: Date
  completedAt: Date | null
  errorMessage: string | null
  taxonomy: { key: string }
  createdBy: { id: string; name: string | null; email: string } | null
}
type SentenceJobRow = JobRow & { totalSentences: number; processedSentences: number; failedSentences: number }

function formatJob(job: JobRow | SentenceJobRow, type: AIJobType) {
  return {
    id: job.id,
    type,
    status: job.status,
    taxonomy: job.taxonomy.key,
    ...('totalSentences' in job
      ? {
          totalSentences: job.totalSentences,
          processedSentences: job.processedSentences,
          failedSentences: job.failedSentences
        }
      : {}),
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
    errorMessage: job.errorMessage,
    createdBy: job.createdBy
  }
}
export type AIJobSummary = ReturnType<typeof formatJob>

async function findJobs(where: Record<string, unknown>) {
  const include = { taxonomy: { select: { key: true } }, createdBy } as const
  const orderBy = { startedAt: 'desc' } as const
  const [labeling, learning, sync] = await Promise.all([
    db().aILabelingJob.findMany({ where, include, orderBy }),
    db().aILearningJob.findMany({ where, include, orderBy }),
    db().aITaxonomySyncJob.findMany({ where, include, orderBy })
  ])
  return [
    ...labeling.map(j => formatJob(j, 'labeling')),
    ...learning.map(j => formatJob(j, 'learning')),
    ...sync.map(j => formatJob(j, 'taxonomy_sync'))
  ]
}

/** Labelling, learning and taxonomy sync jobs, most recent activity first, one page. */
export async function listAIJobs(workspaceId: string, { statusParams, page, limit }: AIJobListQuery) {
  const valid = statusParams.filter((s): s is z.infer<typeof statusSchema> => statusSchema.safeParse(s).success)
  const statuses = valid.length > 0 ? valid : ALL_STATUSES
  const offset = Math.min((page - 1) * limit, Number.MAX_SAFE_INTEGER)
  const [result] = await db().$queryRaw<{ total: number; keys: { id: string; type: AIJobType }[] }[]>`
    WITH jobs AS (
      SELECT id, 'labeling' AS type, COALESCE("completedAt", "startedAt") AS activity FROM "AILabelingJob"
      WHERE "workspaceId" = ${workspaceId} AND status = ANY(${statuses}::"AILabelingJobStatus"[])
      UNION ALL
      SELECT id, 'learning', COALESCE("completedAt", "startedAt") FROM "AILearningJob"
      WHERE "workspaceId" = ${workspaceId} AND status = ANY(${statuses}::"AILabelingJobStatus"[])
      UNION ALL
      SELECT id, 'taxonomy_sync', COALESCE("completedAt", "startedAt") FROM "AITaxonomySyncJob"
      WHERE "workspaceId" = ${workspaceId} AND status = ANY(${statuses}::"AILabelingJobStatus"[])
    ), page AS (
      SELECT id, type, activity FROM jobs ORDER BY activity DESC, id DESC, type
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT (SELECT count(*)::int FROM jobs) AS total,
      COALESCE(json_agg(json_build_object('id', id, 'type', type) ORDER BY activity DESC, id DESC, type), '[]') AS keys
    FROM page
  `
  const { total, keys } = result ?? { total: 0, keys: [] }
  const rows = keys.length ? await findJobs({ workspaceId, id: { in: keys.map(key => key.id) } }) : []
  const jobsByKey = new Map(rows.map(job => [`${job.type}:${job.id}`, job]))
  return {
    ok: true,
    jobs: keys.flatMap(({ id, type }) => jobsByKey.get(`${type}:${id}`) ?? []),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  }
}

/** Queued and running jobs, plus those that finished within `recentMs`. */
export async function listActiveAIJobs(recentMs: number) {
  const recentCutoff = new Date(Date.now() - recentMs)
  return findJobs({
    OR: [
      { status: { in: ['pending', 'processing'] } },
      { status: { in: ['completed', 'failed'] }, completedAt: { gte: recentCutoff } }
    ]
  })
}

/**
 * Cancels a job of the current workspace. A job stuck in processing for more
 * than an hour is marked failed instead. Taxomind is asked to cancel after
 * commit, best effort, through the job's own connection.
 */
export async function cancelAIJob(
  type: AIJobType,
  jobId: string
): Promise<{ status: AILabelingJobStatus; changed: boolean } | null> {
  const kind = JOB_KIND[type]
  const select = { status: true, startedAt: true, taxonomyId: true } as const
  const loadJob = () =>
    kind === 'labeling'
      ? db().aILabelingJob.findUnique({ where: { id: jobId }, select })
      : kind === 'learning'
        ? db().aILearningJob.findUnique({ where: { id: jobId }, select })
        : db().aITaxonomySyncJob.findUnique({ where: { id: jobId }, select })
  const job = await loadJob()
  if (!job) return null
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return { status: job.status, changed: false }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const isStuck = job.status === 'processing' && job.startedAt < oneHourAgo
  const status = isStuck ? ('failed' as const) : ('cancelled' as const)
  const data = {
    status,
    completedAt: new Date(),
    errorMessage: isStuck ? 'Job was stuck in processing state and has been cancelled' : 'Cancelled by user',
    leaseOwner: null,
    leaseExpiresAt: null
  }
  if (kind === 'learning') await lockLearningTaxonomy(job.taxonomyId)
  const change = {
    where: { id: jobId, status: { in: ['pending', 'processing'] satisfies AILabelingJobStatus[] } },
    data,
    select: { externalJobId: true, connectionVersionId: true, workspaceId: true } as const
  }
  const [cancelled] =
    kind === 'labeling'
      ? await db().aILabelingJob.updateManyAndReturn(change)
      : kind === 'learning'
        ? await db().aILearningJob.updateManyAndReturn(change)
        : await db().aITaxonomySyncJob.updateManyAndReturn(change)
  if (!cancelled) {
    const latest = await loadJob()
    return latest ? { status: latest.status, changed: false } : null
  }
  if (kind === 'learning') await settleLearningRun(job.taxonomyId)
  afterCommit(scheduleAIJobs)

  const { externalJobId, connectionVersionId, workspaceId } = cancelled
  if (externalJobId) {
    const requestId = await currentRequestId()
    afterCommit(() => void cancelExternalJob(workspaceId, kind, externalJobId, connectionVersionId, requestId))
  }
  return { status, changed: true }
}

/**
 * The AI state of each taxonomy for the taxonomy and queue pages: the latest
 * sync job (status, time, error). `lastAISyncStatus === 'completed'` means
 * the taxonomy was sent successfully at least once by its latest sync.
 */
export async function latestSyncByTaxonomy(taxonomyIds: string[]) {
  const jobs = await db().aITaxonomySyncJob.findMany({
    where: { taxonomyId: { in: taxonomyIds } },
    orderBy: { startedAt: 'desc' },
    distinct: ['taxonomyId'],
    select: { id: true, taxonomyId: true, status: true, startedAt: true, completedAt: true, errorMessage: true }
  })
  return new Map(
    jobs.map(job => [
      job.taxonomyId,
      {
        lastAISyncJobId: job.id,
        lastAISyncStatus: job.status as string,
        lastAISyncAt: job.completedAt ?? job.startedAt,
        lastAISyncError: job.errorMessage
      }
    ])
  )
}

export const NEVER_SYNCED = {
  lastAISyncJobId: null,
  lastAISyncStatus: null,
  lastAISyncAt: null,
  lastAISyncError: null
}
