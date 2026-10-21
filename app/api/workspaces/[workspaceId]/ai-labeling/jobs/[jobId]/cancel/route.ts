import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { cancelAIJob } from '@/lib/server/ai-jobs'
import { audit } from '@/lib/audit'

// POST: cancel a labeling job (the general route is /ai-jobs/[jobId]/cancel).
export const POST = workspaceRoute<'jobId'>(['admin'], async (_req, { user: actor, params: routeParams }) => {
  const { jobId } = routeParams
  const result = await cancelAIJob('labeling', jobId)
  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (result.changed) {
    await audit({
      actorId: actor.id,
      action: 'ai.job_cancelled',
      entityType: 'ai_job.labeling',
      entityId: jobId,
      payload: { status: result.status }
    })
  }
  return NextResponse.json({ ok: true, status: result.status })
})
