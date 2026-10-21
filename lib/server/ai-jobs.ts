import 'server-only'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// AI job history for the admin page (app/admin/ai-jobs) and /api/ai-jobs.
// Admins only; the caller checks the role.

const statusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])

export type AIJobListQuery = { statusParams: string[]; page: number; limit: number }

/** Labelling, learning and taxonomy sync jobs, most recent activity first, one page. */
export async function listAIJobs({ statusParams, page, limit }: AIJobListQuery) {
  // Build where clauses for each job type
  // Always ensure statusFilter has valid values
  let statusFilter: { in: z.infer<typeof statusSchema>[] }
  if (statusParams.length > 0) {
    const validStatuses = statusParams.filter((s): s is z.infer<typeof statusSchema> => statusSchema.safeParse(s).success)
    if (validStatuses.length > 0) {
      statusFilter = { in: validStatuses }
    } else {
      // If all status params are invalid, default to all statuses
      statusFilter = { in: ['pending', 'processing', 'completed', 'failed', 'cancelled'] }
    }
  } else {
    // Default: show all statuses (empty filter means all)
    statusFilter = { in: ['pending', 'processing', 'completed', 'failed', 'cancelled'] }
  }

  // Fetch all job types
  const [labelingJobs, learningJobs, syncTaxonomies] = await Promise.all([
    prisma.aILabelingJob.findMany({
      where: { status: statusFilter },
      orderBy: { startedAt: 'desc' },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    }),
    prisma.aILearningJob.findMany({
      where: { status: statusFilter },
      orderBy: { startedAt: 'desc' },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    }),
    // Taxonomy sync jobs (still stored on Taxonomy model)
    prisma.taxonomy.findMany({
      where: {
        lastAISyncStatus: statusParams.length > 0 ? { in: statusParams } : { not: null }
      },
      select: {
        id: true, key: true,
        lastAISyncJobId: true, lastAISyncStatus: true,
        lastAISyncAt: true, lastAISyncError: true, updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    })
  ])

  const formatSentenceJob = (job: typeof labelingJobs[0] | typeof learningJobs[0], type: 'labeling' | 'learning') => ({
    id: job.id,
    type,
    status: job.status,
    taxonomy: job.taxonomy.key,
    totalSentences: job.totalSentences,
    processedSentences: job.processedSentences,
    failedSentences: job.failedSentences,
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
    errorMessage: job.errorMessage,
    createdBy: job.createdBy
  })

  // Combine and format all jobs
  const allJobs = [
    ...labelingJobs.map(j => formatSentenceJob(j, 'labeling')),
    ...learningJobs.map(j => formatSentenceJob(j, 'learning')),
    ...syncTaxonomies.map(taxonomy => ({
      id: taxonomy.lastAISyncJobId || `sync-${taxonomy.id}`,
      type: 'taxonomy_sync' as const,
      status: taxonomy.lastAISyncStatus || 'pending',
      taxonomy: taxonomy.key,
      startedAt: taxonomy.lastAISyncAt?.toISOString() || taxonomy.updatedAt.toISOString(),
      completedAt: taxonomy.lastAISyncStatus === 'completed' || taxonomy.lastAISyncStatus === 'failed' || taxonomy.lastAISyncStatus === 'cancelled' ? (taxonomy.lastAISyncAt?.toISOString() || taxonomy.updatedAt.toISOString()) : null,
      errorMessage: taxonomy.lastAISyncError,
      createdBy: null
    }))
  ]

  // Sort by most recent activity (completedAt if available, otherwise startedAt)
  allJobs.sort((a, b) => {
    const timeA = new Date(a.completedAt || a.startedAt).getTime()
    const timeB = new Date(b.completedAt || b.startedAt).getTime()
    if (timeB !== timeA) return timeB - timeA
    return b.id.localeCompare(a.id)
  })

  // Apply pagination
  const total = allJobs.length
  const paginatedJobs = allJobs.slice((page - 1) * limit, page * limit)

  return {
    ok: true,
    jobs: paginatedJobs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  }
}
