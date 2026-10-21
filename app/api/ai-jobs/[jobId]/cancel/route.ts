import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { cancelAIJob } from '@/lib/ai-labeling'
import type { CaughtError } from '@/lib/utils'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { error: authError } = await requireSession('admin')
    if (authError) return authError

    const body = await req.json()
    const { type } = body as { type: 'labeling' | 'learning' | 'taxonomy_sync' | 'external_training' }
    const { jobId } = await params

    // Handle different job types
    if (type === 'labeling') {
      const job = await prisma.aILabelingJob.findUnique({
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

      await prisma.aILabelingJob.update({
        where: { id: jobId },
        data: {
          status: isStuck ? 'failed' : 'cancelled',
          completedAt: new Date(),
          errorMessage: isStuck
            ? 'Job was stuck in processing state and has been cancelled'
            : 'Cancelled by user'
        }
      })

      return NextResponse.json({ ok: true, status: isStuck ? 'failed' : 'cancelled' })
    }

    if (type === 'external_training') {
      const job = await prisma.aIExternalTrainingJob.findUnique({
        where: { id: jobId },
        select: { status: true }
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return NextResponse.json({ ok: true, status: job.status })
      }

      // External training jobs don't store a remote job id, so only the local record can be cancelled
      await prisma.aIExternalTrainingJob.update({
        where: { id: jobId },
        data: {
          status: 'cancelled',
          completedAt: new Date()
        }
      })

      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    if (type === 'learning') {
      const job = await prisma.aILearningJob.findUnique({
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

      await prisma.aILearningJob.update({
        where: { id: jobId },
        data: {
          status: isStuck ? 'failed' : 'cancelled',
          completedAt: new Date(),
          errorMessage: isStuck
            ? 'Job was stuck in processing state and has been cancelled'
            : 'Cancelled by user'
        }
      })

      return NextResponse.json({ ok: true, status: isStuck ? 'failed' : 'cancelled' })
    }

    if (type === 'taxonomy_sync') {
      // Find taxonomy by lastAISyncJobId
      const taxonomy = await prisma.taxonomy.findFirst({
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

      await prisma.taxonomy.update({
        where: { id: taxonomy.id },
        data: {
          lastAISyncStatus: 'cancelled',
          lastAISyncError: 'Cancelled by user'
        }
      })

      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    return NextResponse.json({ error: 'Invalid job type' }, { status: 400 })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to cancel AI job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to cancel job' }, { status: 500 })
  }
}

