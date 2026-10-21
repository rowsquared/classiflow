import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { cancelAIJob } from '@/lib/server/ai-jobs'
import { audit } from '@/lib/audit'

const bodySchema = z.object({ type: z.enum(['labeling', 'learning', 'taxonomy_sync']) })

// POST: cancel a labeling, learning or taxonomy sync job of this workspace.
export const POST = workspaceRoute<'jobId'>(['admin'], async (req, { user: actor, params: routeParams }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid job type' }, { status: 400 })
  }
  const { type } = parsed.data
  const { jobId } = routeParams

  const result = await cancelAIJob(type, jobId)
  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (result.changed) {
    await audit({
      actorId: actor.id,
      action: 'ai.job_cancelled',
      entityType: `ai_job.${type}`,
      entityId: jobId,
      payload: { status: result.status }
    })
  }
  return NextResponse.json({ ok: true, status: result.status })
})
