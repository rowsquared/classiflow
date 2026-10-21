import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { AILabelingJobStatus } from '@prisma/client'
import { ensureJobsMonitored } from '@/lib/ai-job-monitor'

// How long recently finished jobs are included in the response
const RECENT_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Trigger recovery for any orphaned jobs (rate-limited internally)
    try {
      await ensureJobsMonitored()
    } catch (err) {
      console.error('ensureJobsMonitored error:', err)
    }

    const recentCutoff = new Date(Date.now() - RECENT_WINDOW_MS)

    // Same shape for all three job models (they share the AILabelingJobStatus enum)
    const activeOrRecent: {
      OR: Array<{ status: { in: AILabelingJobStatus[] }; completedAt?: { gte: Date } }>
    } = {
      OR: [
        { status: { in: ['pending', 'processing'] } },
        { status: { in: ['completed', 'failed'] }, completedAt: { gte: recentCutoff } }
      ]
    }

    // Get all active + recently finished jobs across all types
    const [labelingJobs, learningJobs, trainingJobs, syncJobs] = await Promise.all([
      prisma.aILabelingJob.findMany({
        where: activeOrRecent,
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        },
        orderBy: { startedAt: 'desc' }
      }),
      prisma.aILearningJob.findMany({
        where: activeOrRecent,
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        },
        orderBy: { startedAt: 'desc' }
      }),
      prisma.aIExternalTrainingJob.findMany({
        where: activeOrRecent,
        include: {
          taxonomy: { select: { key: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        },
        orderBy: { startedAt: 'desc' }
      }),
      // Taxonomy sync jobs (still stored on Taxonomy model)
      prisma.taxonomy.findMany({
        where: {
          lastAISyncStatus: { in: ['pending', 'processing', 'failed'] }
        },
        select: {
          id: true, key: true,
          lastAISyncJobId: true, lastAISyncStatus: true,
          lastAISyncAt: true, lastAISyncError: true
        }
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

    // Format all jobs into a unified structure
    const allJobs = [
      ...labelingJobs.map(j => formatSentenceJob(j, 'labeling')),
      ...learningJobs.map(j => formatSentenceJob(j, 'learning')),
      ...trainingJobs.map(job => ({
        id: job.id,
        type: 'external_training' as const,
        status: job.status,
        taxonomy: job.taxonomy.key,
        recordCount: job.recordCount,
        fileName: job.fileName,
        startedAt: job.startedAt.toISOString(),
        completedAt: job.completedAt?.toISOString() || null,
        createdBy: job.createdBy
      })),
      ...syncJobs.map(taxonomy => ({
        id: taxonomy.lastAISyncJobId || `sync-${taxonomy.id}`,
        type: 'taxonomy_sync' as const,
        status: taxonomy.lastAISyncStatus === 'success' ? 'completed' : (taxonomy.lastAISyncStatus || 'pending'),
        taxonomy: taxonomy.key,
        startedAt: taxonomy.lastAISyncAt?.toISOString() || new Date().toISOString(),
        errorMessage: taxonomy.lastAISyncError || null
      }))
    ]

    return NextResponse.json({ ok: true, jobs: allJobs })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch active jobs'
    console.error('Failed to fetch active jobs:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
