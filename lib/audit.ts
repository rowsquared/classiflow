import type { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { currentWorkspaceId, db, withWorkspace } from '@/lib/workspace/db'

/**
 * Audit trail of administrative and access-relevant events, stored in
 * AuditLog. Workspace events carry their workspace and are listed to its
 * admins at /w/[workspaceId]/admin/audit; platform events (accounts,
 * workspaces) have no workspace.
 *
 * Recorded: account, membership, workspace, taxonomy, import, assignment,
 * bulk-label, export and AI job changes, and refused access (`access.denied`).
 * Not recorded: individual label saves, comments and flags; those rows carry
 * their own author and timestamps.
 *
 * Payloads hold identifiers, counts and changed field names only, never record
 * text, label values beyond codes, or passwords.
 *
 * Inside a workspace transaction the entry is written in that transaction and
 * commits (or rolls back) with the change. Elsewhere writing is best effort: a
 * failure is logged and never fails the request.
 */

export type AuditAction =
  | 'user.created' | 'user.updated' | 'user.deleted' | 'user.password_changed'
  | 'workspace.created' | 'workspace.updated' | 'workspace.archived' | 'workspace.reopened'
  | 'member.added' | 'member.updated' | 'member.suspended' | 'member.reactivated'
  | 'taxonomy.created' | 'taxonomy.updated' | 'taxonomy.deleted' | 'taxonomy.imported'
  | 'taxonomy.restored' | 'taxonomy.ai_sync_started'
  | 'records.imported' | 'import.deleted'
  | 'assignments.added' | 'assignments.removed'
  | 'labels.bulk_applied'
  | 'export.downloaded'
  | 'ai.labeling_started' | 'ai.learning_started' | 'ai.job_cancelled'
  | 'access.denied'

export type AuditEntry = {
  /** Defaults to the current workspace transaction's; null for platform events. */
  workspaceId?: string | null
  actorId: string | null
  action: AuditAction
  entityType: string
  entityId: string
  payload?: Prisma.InputJsonValue
}

export async function audit(entry: AuditEntry): Promise<void> {
  const inTransaction = currentWorkspaceId()
  const workspaceId = entry.workspaceId === undefined ? inTransaction : entry.workspaceId
  const write = async (client: Pick<Prisma.TransactionClient, 'user' | 'auditLog'>) => {
    const actorName = entry.actorId
      ? (await client.user.findUnique({ where: { id: entry.actorId }, select: { username: true } }))?.username ?? null
      : null
    await client.auditLog.create({ data: { ...entry, workspaceId, actorName } })
  }

  if (inTransaction && workspaceId === inTransaction) {
    await write(db())
    return
  }
  try {
    if (workspaceId) {
      await withWorkspace(workspaceId, () => write(db()))
    } else {
      await write(prisma)
    }
  } catch (error) {
    console.error(`[audit] could not record ${entry.action} on ${entry.entityType} ${entry.entityId}:`, error)
  }
}
