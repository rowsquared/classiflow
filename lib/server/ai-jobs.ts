import 'server-only'
import { afterCommit, db } from '@/lib/workspace/db'
import { cancelExternalJob, type JobKind } from '@/lib/ai-job-monitor'
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
  const allJobs = await findJobs({ workspaceId, status: { in: valid.length > 0 ? valid : ALL_STATUSES } })

  // Sort by most recent activity (completedAt if available, otherwise startedAt)
  allJobs.sort((a, b) => {
    const timeA = new Date(a.completedAt || a.startedAt).getTime()
    const timeB = new Date(b.completedAt || b.startedAt).getTime()
    if (timeB !== timeA) return timeB - timeA
    return b.id.localeCompare(a.id)
  })

  const total = allJobs.length
  return {
    ok: true,
    jobs: allJobs.slice((page - 1) * limit, page * limit),
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
  const select = { status: true, startedAt: true, externalJobId: true, connectionVersionId: true, workspaceId: true }
  const job =
    kind === 'labeling'
      ? await db().aILabelingJob.findUnique({ where: { id: jobId }, select })
      : kind === 'learning'
        ? await db().aILearningJob.findUnique({ where: { id: jobId }, select })
        : await db().aITaxonomySyncJob.findUnique({ where: { id: jobId }, select })
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
  if (kind === 'labeling') await db().aILabelingJob.update({ where: { id: jobId }, data })
  else if (kind === 'learning') await db().aILearningJob.update({ where: { id: jobId }, data })
  else await db().aITaxonomySyncJob.update({ where: { id: jobId }, data })

  const { externalJobId, connectionVersionId, workspaceId } = job
  if (externalJobId) {
    afterCommit(() => void cancelExternalJob(workspaceId, kind, externalJobId, connectionVersionId))
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
