import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { cancelAIJob } from '@/lib/ai-labeling'
import type { CaughtError } from '@/lib/utils'
import { audit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { user: actor, error: authError } = await requireSession('admin')
    if (authError) return authError

    const { jobId } = await params
    const job = await prisma.aILabelingJob.findUnique({
      where: { id: jobId },
      select: { status: true, externalJobId: true }
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

    await prisma.aILabelingJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        completedAt: new Date()
      }
    })

    await audit({ actorId: actor.id, action: 'ai.job_cancelled', entityType: 'ai_job.labeling', entityId: jobId, payload: { status: 'cancelled' } })
    return NextResponse.json({ ok: true, status: 'cancelled' })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to cancel AI labeling job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to cancel job' }, { status: 500 })
  }
}

