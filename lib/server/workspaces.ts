import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Role, SessionUser, CurrentUser } from '@/lib/api-auth'
import { afterCommit, db, withWorkspace } from '@/lib/workspace/db'
import { cancelExternalJob } from '@/lib/ai-job-monitor'
import { currentRequestId } from '@/lib/request-id'
import { auditInTransaction, audit } from '@/lib/audit'
import { connectionClient } from '@/lib/ai-connections'
import { logger } from '@/lib/logger'

// The workspace directory and lifecycle (control plane). Workspace and
// membership rows have no row security; workspace data is touched only
// through withWorkspace().

export type WorkspaceSummary = {
  id: string
  name: string
  description: string | null
  status: 'active' | 'archived'
  role: Role
  authority: 'membership' | 'platform'
  aiEnabled: boolean
  archivedAt: Date | null
}

/**
 * Workspaces the user may enter, with their effective role: every workspace
 * for platform admins, otherwise those with an active membership. Nothing
 * about other workspaces (names, counts, members) is returned.
 */
export async function listAccessibleWorkspaces(user: SessionUser): Promise<WorkspaceSummary[]> {
  const select = { id: true, name: true, description: true, status: true, aiEnabled: true, archivedAt: true } as const
  if (user.platformRole === 'admin') {
    const [workspaces, memberships] = await Promise.all([
      prisma.workspace.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.workspaceMembership.findMany({
        where: { userId: user.id, status: 'active' },
        select: { workspaceId: true }
      })
    ])
    const member = new Set(memberships.map(m => m.workspaceId))
    return workspaces.map(w => ({ ...w, role: 'admin', authority: member.has(w.id) ? 'membership' : 'platform' }))
  }
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id, status: 'active' },
    select: { role: true, workspace: { select } },
    orderBy: { workspace: { name: 'asc' } }
  })
  return memberships.map(m => ({ ...m.workspace, role: m.role, authority: 'membership' }))
}

/**
 * A new workspace with its first admin membership and both audit entries
 * (platform: workspace.created; workspace: member.added), in one transaction.
 * Null when the admin user does not exist or is disabled.
 */
export async function createWorkspace(input: {
  name: string
  description: string | null
  adminUserId: string
  createdById: string
}) {
  return prisma.$transaction(async tx => {
    const admin = await tx.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, username: true, banned: true }
    })
    if (!admin || admin.banned) return null
    const workspace = await tx.workspace.create({
      data: { name: input.name, description: input.description, createdById: input.createdById },
      select: { id: true, name: true, description: true, status: true }
    })
    await tx.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: admin.id, role: 'admin', addedById: input.createdById }
    })
    await auditInTransaction(tx, {
      workspaceId: null,
      actorId: input.createdById,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: workspace.id,
      payload: { name: workspace.name, adminUserId: admin.id }
    })
    // The workspace's own entry needs the workspace's row-security context
    // (transaction-local, like withWorkspace()).
    await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspace.id}, true)`
    const actorName = (await tx.user.findUnique({ where: { id: input.createdById }, select: { username: true } }))
      ?.username
    await tx.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorId: input.createdById,
        actorName: actorName ?? null,
        action: 'member.added',
        entityType: 'user',
        entityId: admin.id,
        payload: { username: admin.username, role: 'admin', firstAdmin: true, authority: 'platform' }
      }
    })
    return workspace
  })
}

export async function updateWorkspace(
  actor: CurrentUser,
  data: { name?: string; description?: string | null; status?: 'active' | 'archived' }
) {
  const workspaceId = actor.workspaceId
  return withWorkspace(workspaceId, async () => {
    await db().$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`
    const current = await db().workspace.findUnique({ where: { id: workspaceId } })
    if (!current) return { status: 404, error: 'Workspace not found' } as const
    const { status, ...details } = data
    if (current.status === 'archived' && status !== 'active' && Object.keys(details).length)
      return { status: 409, error: 'Reopen this workspace before changing its details' } as const
    if (Object.keys(details).length) {
      await db().workspace.update({ where: { id: workspaceId }, data: details })
      await audit({
        actorId: actor.id,
        action: 'workspace.updated',
        entityType: 'workspace',
        entityId: workspaceId,
        payload: { fields: Object.keys(details), authority: actor.authority }
      })
    }
    if (status && status !== current.status) {
      const cancelledJobs = await setWorkspaceStatus(workspaceId, status)
      await audit({
        actorId: actor.id,
        action: status === 'archived' ? 'workspace.archived' : 'workspace.reopened',
        entityType: 'workspace',
        entityId: workspaceId,
        payload: { cancelledJobs, authority: actor.authority }
      })
    }
    return { status: 200, ok: true } as const
  })
}

/**
 * Archives or reopens a workspace. Archiving takes an exclusive lock on the
 * workspace row, so it waits for writes in flight (they hold share locks) and
 * no write starts afterwards; queued and running AI jobs are cancelled in the
 * same transaction so a late result cannot be stored. Once committed, the AI
 * service is asked to cancel the jobs it already has (best effort, through
 * each job's own connection; archival never waits for it). Returns the number
 * of cancelled jobs.
 */
export async function setWorkspaceStatus(workspaceId: string, status: 'active' | 'archived'): Promise<number> {
  return withWorkspace(workspaceId, async () => {
    await db().$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`
    await db().workspace.update({
      where: { id: workspaceId },
      data: { status, archivedAt: status === 'archived' ? new Date() : null }
    })
    if (status !== 'archived') return 0
    const active = { status: { in: ['pending' as const, 'processing' as const] } }
    const select = { id: true, externalJobId: true, connectionVersionId: true } as const
    const [labeling, learning, sync] = await Promise.all([
      db().aILabelingJob.findMany({ where: active, select }),
      db().aILearningJob.findMany({ where: active, select }),
      db().aITaxonomySyncJob.findMany({ where: active, select })
    ])
    const cancelled = {
      status: 'cancelled' as const,
      completedAt: new Date(),
      errorMessage: 'Workspace archived',
      leaseOwner: null,
      leaseExpiresAt: null
    }
    await db().aILabelingJob.updateMany({ where: active, data: cancelled })
    await db().aILearningJob.updateMany({ where: active, data: cancelled })
    await db().aITaxonomySyncJob.updateMany({ where: active, data: cancelled })

    const external = [
      ...labeling.map(job => ({ kind: 'labeling' as const, ...job })),
      ...learning.map(job => ({ kind: 'learning' as const, ...job })),
      ...sync.map(job => ({ kind: 'sync' as const, ...job }))
    ].flatMap(job => (job.externalJobId ? [{ ...job, externalJobId: job.externalJobId }] : []))
    if (external.length > 0) {
      const requestId = await currentRequestId()
      afterCommit(() => {
        for (const job of external) {
          void cancelExternalJob(workspaceId, job.kind, job.externalJobId, job.connectionVersionId, requestId)
        }
      })
    }
    return labeling.length + learning.length + sync.length
  })
}

/** Child-first deletion order. Integration tests compare this with every workspace-owned table. */
export const WORKSPACE_DELETE_TABLES = [
  'OutgoingMail',
  'MemberImportRow',
  'MemberImport',
  'WorkspaceInvitation',
  'DoubleTaskLabel',
  'DoubleOutcome',
  'DoubleTask',
  'DoubleRound',
  'LabelingActivity',
  'SentenceAnnotation',
  'SentenceAISuggestion',
  'Comment',
  'AILabelingJobInput',
  'AILearningJobInput',
  'AILabelingJob',
  'AILearningJob',
  'AITaxonomySyncJob',
  'AIConnectionVersion',
  'SentenceAssignment',
  'Sentence',
  'SentenceImport',
  'TaxonomySynonym',
  'TaxonomyNode',
  'TaxonomySetting',
  'Taxonomy',
  'WorkspaceMembership',
  'AIEndpointGrant',
  'AuditLog'
] as const

async function workspaceCounts(workspaceId: string) {
  const counts: Record<string, number> = {}
  for (const table of WORKSPACE_DELETE_TABLES) {
    // Identifiers come exclusively from the static allowlist above. Values remain parameters.
    const [row] = await db().$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) FROM "${table}" WHERE "workspaceId" = $1`,
      workspaceId
    )
    counts[table] = Number(row?.count ?? 0)
  }
  return counts
}

export async function workspaceDeletionPreview(workspaceId: string) {
  return withWorkspace(workspaceId, async () => {
    const workspace = await db().workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, status: true }
    })
    if (!workspace) return null
    return { workspace, counts: await workspaceCounts(workspaceId) }
  })
}

export async function deleteWorkspace(workspaceId: string, name: string, actorId: string) {
  // Materialise clients before deleting connection rows. No HTTP call holds a DB transaction open.
  const jobs = await withWorkspace(workspaceId, async () => {
    const select = { externalJobId: true, connectionVersionId: true } as const
    const where = { externalJobId: { not: null }, status: 'cancelled' as const }
    const [label, learn, taxonomies] = await Promise.all([
      db().aILabelingJob.findMany({ where, select }),
      db().aILearningJob.findMany({ where, select }),
      db().aITaxonomySyncJob.findMany({ where, select })
    ])
    return [
      ...label.map(j => ({ ...j, resource: 'label' as const })),
      ...learn.map(j => ({ ...j, resource: 'learn' as const })),
      ...taxonomies.map(j => ({ ...j, resource: 'taxonomies' as const }))
    ]
  })
  const clients = new Map<string, Awaited<ReturnType<typeof connectionClient>>>()
  const requestId = await currentRequestId()
  for (const connectionId of new Set(jobs.map(job => job.connectionVersionId))) {
    try {
      clients.set(connectionId, await connectionClient(workspaceId, connectionId, requestId))
    } catch {
      logger.warn(
        { workspaceId, connectionId },
        'External cancellation unavailable: connection credential no longer exists'
      )
    }
  }
  const result = await withWorkspace(workspaceId, async () => {
    await db().$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`
    const workspace = await db().workspace.findUnique({ where: { id: workspaceId } })
    if (!workspace) return { status: 404, error: 'Workspace not found' } as const
    if (workspace.status !== 'archived')
      return { status: 409, error: 'Archive the workspace before deleting it' } as const
    if (workspace.name !== name)
      return { status: 409, error: 'The workspace name does not match. Refresh and try again.' } as const
    const counts = await workspaceCounts(workspaceId)
    for (const table of WORKSPACE_DELETE_TABLES) {
      await db().$executeRawUnsafe(`DELETE FROM "${table}" WHERE "workspaceId" = $1`, workspaceId)
    }
    await db().workspace.delete({ where: { id: workspaceId } })
    // AuditLog permits platform events only outside a workspace RLS context.
    // All scoped deletions are complete; keep the event in this same transaction.
    await db().$executeRaw`SELECT set_config('app.workspace_id', '', true)`
    await auditInTransaction(db(), {
      workspaceId: null,
      actorId,
      action: 'workspace.deleted',
      entityType: 'workspace',
      entityId: workspaceId,
      payload: { name, counts, externalDataRetained: true }
    })
    return { status: 200, ok: true } as const
  })
  if ('ok' in result) {
    // Bound concurrency even when a workspace has a long job history.
    for (let offset = 0; offset < jobs.length; offset += 4)
      await Promise.all(
        jobs.slice(offset, offset + 4).map(async job => {
          const connection = clients.get(job.connectionVersionId)
          if (!connection) return
          try {
            await connection.client.cancelJob(job.resource, job.externalJobId!)
          } catch {
            logger.warn(
              { workspaceId, externalJobId: job.externalJobId },
              'Could not cancel external job after workspace deletion'
            )
          }
        })
      )
    logger.info({ workspaceId }, 'Workspace deleted; AI service namespace retained')
  }
  return result
}

export async function workspaceManagementSummaries(actor: SessionUser) {
  const workspaces = await listAccessibleWorkspaces(actor)
  if (actor.platformRole !== 'admin') return workspaces.map(w => ({ ...w, counts: null }))
  const result = []
  for (const workspace of workspaces) {
    const counts = await withWorkspace(workspace.id, async () => ({
      members: await db().workspaceMembership.count({ where: { status: 'active' } }),
      records: await db().sentence.count(),
      submitted: await db().sentence.count({ where: { status: 'submitted' } }),
      taxonomies: await db().taxonomy.count()
    }))
    result.push({ ...workspace, counts })
  }
  return result
}
