import type { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { currentWorkspaceId, db, withWorkspace } from '@/lib/workspace/db'
import { logError } from '@/lib/logger'
import { currentRequestId } from '@/lib/request-id'

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
 *
 * Entries written during a request carry its ID (`requestId`, see
 * lib/request-id.ts), which also appears on that request's log lines.
 */

export type AuditAction =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.password_changed'
  | 'user.sessions_revoked'
  | 'user.email_changed'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.archived'
  | 'workspace.reopened'
  | 'member.added'
  | 'member.updated'
  | 'member.suspended'
  | 'member.reactivated'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'members.imported'
  | 'mail.password_link_requested'
  | 'mail.invitation_requested'
  | 'mail.sent'
  | 'mail.failed'
  | 'mail.unknown'
  | 'taxonomy.created'
  | 'taxonomy.updated'
  | 'taxonomy.deleted'
  | 'taxonomy.imported'
  | 'taxonomy.restored'
  | 'taxonomy.ai_sync_started'
  | 'records.imported'
  | 'import.deleted'
  | 'assignments.added'
  | 'assignments.removed'
  | 'labels.bulk_applied'
  | 'export.downloaded'
  | 'ai.labeling_started'
  | 'ai.learning_started'
  | 'ai.job_cancelled'
  | 'ai.enabled'
  | 'ai.disabled'
  | 'ai.connection_created'
  | 'ai.connection_removed'
  | 'ai.endpoint_approved'
  | 'ai.endpoint_retired'
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

type AuditDb = Pick<Prisma.TransactionClient, 'user' | 'auditLog'>

async function writeEntry(client: AuditDb, entry: AuditEntry, workspaceId: string | null) {
  const actorName = entry.actorId
    ? ((await client.user.findUnique({ where: { id: entry.actorId }, select: { username: true } }))?.username ?? null)
    : null
  const requestId = await currentRequestId()
  await client.auditLog.create({ data: { ...entry, workspaceId, actorName, requestId } })
}

/**
 * Writes a platform event (no workspace) in the caller's own transaction, so
 * it commits or rolls back with the change. Errors propagate.
 */
export async function auditInTransaction(client: AuditDb, entry: AuditEntry & { workspaceId: null }): Promise<void> {
  await writeEntry(client, entry, null)
}

export async function audit(entry: AuditEntry): Promise<void> {
  const inTransaction = currentWorkspaceId()
  const workspaceId = entry.workspaceId === undefined ? inTransaction : entry.workspaceId
  const write = (client: AuditDb) => writeEntry(client, entry, workspaceId)

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
    await logError('Could not record audit entry', error, {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId
    })
  }
}
