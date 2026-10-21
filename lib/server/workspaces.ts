import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Role, SessionUser } from '@/lib/api-auth'
import { afterCommit, db, withWorkspace } from '@/lib/workspace/db'
import { cancelExternalJob } from '@/lib/ai-job-monitor'
import { auditInTransaction } from '@/lib/audit'

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
}

/**
 * Workspaces the user may enter, with their effective role: every workspace
 * for platform admins, otherwise those with an active membership. Nothing
 * about other workspaces (names, counts, members) is returned.
 */
export async function listAccessibleWorkspaces(user: SessionUser): Promise<WorkspaceSummary[]> {
  const select = { id: true, name: true, description: true, status: true } as const
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
 * Null when the admin user does not exist.
 */
export async function createWorkspace(input: {
  name: string
  description: string | null
  adminUserId: string
  createdById: string
}) {
  return prisma.$transaction(async tx => {
    const admin = await tx.user.findUnique({ where: { id: input.adminUserId }, select: { id: true, username: true } })
    if (!admin) return null
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

export async function updateWorkspace(workspaceId: string, data: { name?: string; description?: string | null }) {
  await prisma.workspace.update({ where: { id: workspaceId }, data })
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
      afterCommit(() => {
        for (const job of external) {
          void cancelExternalJob(workspaceId, job.kind, job.externalJobId, job.connectionVersionId)
        }
      })
    }
    return labeling.length + learning.length + sync.length
  })
}
