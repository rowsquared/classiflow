import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { db } from '@/lib/workspace/db'
import { cancelAIJob } from '@/lib/ai-labeling'
import type { CaughtError } from '@/lib/utils'
import { audit } from '@/lib/audit'

export const POST = workspaceRoute<'jobId'>(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const { jobId } = routeParams
    const job = await db().aILabelingJob.findUnique({
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

    await db().aILabelingJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        completedAt: new Date()
      }
    })

    await audit({
      actorId: actor.id,
      action: 'ai.job_cancelled',
      entityType: 'ai_job.labeling',
      entityId: jobId,
      payload: { status: 'cancelled' }
    })
    return NextResponse.json({ ok: true, status: 'cancelled' })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to cancel AI labeling job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to cancel job' }, { status: 500 })
  }
})
