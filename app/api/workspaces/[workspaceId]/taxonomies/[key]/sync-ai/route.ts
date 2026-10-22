import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { afterCommit, db, scopeWorkspaceId } from '@/lib/workspace/db'
import { scheduleAIJobs } from '@/lib/ai-job-monitor'
import { AI_UNAVAILABLE_MESSAGES, connectionForNewJobs } from '@/lib/ai-connections'
import { audit } from '@/lib/audit'
import { currentRequestId } from '@/lib/request-id'

// POST: queue a sync of this taxonomy to the AI service. The job
// (AITaxonomySyncJob) is admitted, sent and polled by lib/ai-job-monitor.ts
// like labeling and learning jobs; the taxonomy is read when it is sent.
export const POST = workspaceRoute<'key'>(['admin'], async (_req, { user: actor, params: routeParams }) => {
  const workspaceId = scopeWorkspaceId()
  const taxonomy = await db().taxonomy.findUnique({
    where: { workspaceId_key: { workspaceId, key: routeParams.key } },
    select: { id: true, key: true, _count: { select: { nodes: true } } }
  })
  if (!taxonomy) {
    return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
  }
  if (taxonomy._count.nodes === 0) {
    return NextResponse.json({ error: 'The taxonomy has no nodes to send' }, { status: 400 })
  }

  const connection = await connectionForNewJobs()
  if ('unavailable' in connection) {
    return NextResponse.json(
      { error: AI_UNAVAILABLE_MESSAGES[connection.unavailable], code: connection.unavailable },
      { status: 409 }
    )
  }

  // One sync per taxonomy at a time; the row lock serialises concurrent requests.
  await db().$queryRaw`SELECT 1 FROM "Taxonomy" WHERE id = ${taxonomy.id} FOR UPDATE`
  const running = await db().aITaxonomySyncJob.count({
    where: { taxonomyId: taxonomy.id, status: { in: ['pending', 'processing'] } }
  })
  if (running > 0) {
    return NextResponse.json({ error: 'This taxonomy is already being synced' }, { status: 409 })
  }

  const job = await db().aITaxonomySyncJob.create({
    data: {
      workspaceId,
      taxonomyId: taxonomy.id,
      connectionVersionId: connection.id,
      createdById: actor.id,
      requestId: await currentRequestId()
    },
    select: { id: true, status: true }
  })
  afterCommit(scheduleAIJobs)

  await audit({
    actorId: actor.id,
    action: 'taxonomy.ai_sync_started',
    entityType: 'taxonomy',
    entityId: taxonomy.id,
    payload: { key: taxonomy.key, jobId: job.id }
  })
  return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
})
