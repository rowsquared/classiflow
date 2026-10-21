import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { db } from '@/lib/workspace/db'
import { cancelAIJob } from '@/lib/ai-labeling'
import type { CaughtError } from '@/lib/utils'
import { audit } from '@/lib/audit'

export const POST = workspaceRoute(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const body = await req.json()
    const { type } = body as { type: 'labeling' | 'learning' | 'taxonomy_sync' }
    const { jobId } = routeParams

    // Handle different job types
    if (type === 'labeling') {
      const job = await db().aILabelingJob.findUnique({
        where: { id: jobId },
        select: { status: true, startedAt: true, externalJobId: true }
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return NextResponse.json({ ok: true, status: job.status })
      }

      if (job.externalJobId) {
        cancelAIJob('/label', job.externalJobId)
      }

      // For stuck jobs (processing for > 1 hour), mark as failed instead of cancelled
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const isStuck = job.status === 'processing' && job.startedAt < oneHourAgo

      await db().aILabelingJob.update({
        where: { id: jobId },
        data: {
          status: isStuck ? 'failed' : 'cancelled',
          completedAt: new Date(),
          errorMessage: isStuck
            ? 'Job was stuck in processing state and has been cancelled'
            : 'Cancelled by user'
        }
      })

      await audit({ actorId: actor.id, action: 'ai.job_cancelled', entityType: `ai_job.${type}`, entityId: jobId, payload: { status: isStuck ? 'failed' : 'cancelled' } })
      return NextResponse.json({ ok: true, status: isStuck ? 'failed' : 'cancelled' })
    }

    if (type === 'learning') {
      const job = await db().aILearningJob.findUnique({
        where: { id: jobId },
        select: { status: true, startedAt: true, externalJobId: true }
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return NextResponse.json({ ok: true, status: job.status })
      }

      if (job.externalJobId) {
        cancelAIJob('/learn', job.externalJobId)
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const isStuck = job.status === 'processing' && job.startedAt < oneHourAgo

      await db().aILearningJob.update({
        where: { id: jobId },
        data: {
          status: isStuck ? 'failed' : 'cancelled',
          completedAt: new Date(),
          errorMessage: isStuck
            ? 'Job was stuck in processing state and has been cancelled'
            : 'Cancelled by user'
        }
      })

      await audit({ actorId: actor.id, action: 'ai.job_cancelled', entityType: `ai_job.${type}`, entityId: jobId, payload: { status: isStuck ? 'failed' : 'cancelled' } })
      return NextResponse.json({ ok: true, status: isStuck ? 'failed' : 'cancelled' })
    }

    if (type === 'taxonomy_sync') {
      // Find taxonomy by lastAISyncJobId
      const taxonomy = await db().taxonomy.findFirst({
        where: {
          lastAISyncJobId: jobId,
          lastAISyncStatus: { in: ['pending', 'processing'] }
        },
        select: { id: true }
      })

      if (!taxonomy) {
        return NextResponse.json({ error: 'Job not found or already completed' }, { status: 404 })
      }

      // jobId here is the external AI job ID (stored in lastAISyncJobId)
      cancelAIJob('/taxonomies', jobId)

      await db().taxonomy.update({
        where: { id: taxonomy.id },
        data: {
          lastAISyncStatus: 'cancelled',
          lastAISyncError: 'Cancelled by user'
        }
      })

      await audit({ actorId: actor.id, action: 'ai.job_cancelled', entityType: `ai_job.${type}`, entityId: jobId, payload: { status: 'cancelled' } })
      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    return NextResponse.json({ error: 'Invalid job type' }, { status: 400 })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to cancel AI job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to cancel job' }, { status: 500 })
  }
})

