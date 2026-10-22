import type { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { currentWorkspaceId, db, withWorkspace } from '@/lib/workspace/db'
import { logError, logger } from '@/lib/logger'
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
  | 'members.exported'
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
  | 'ai.endpoint_access_changed'
  | 'ai.job_settings_changed'
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

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60_000
const PRUNE_INTERVAL_MS = 6 * 60 * 60_000

/** Days audit entries are kept (AUDIT_RETENTION_DAYS, default 730); null: forever (`0`). */
export function auditRetentionDays(raw = process.env.AUDIT_RETENTION_DAYS): number | null {
  const value = raw?.trim()
  if (value === '0') return null
  const days = Number(value)
  return value && Number.isInteger(days) && days > 0 ? days : 730
}

/**
 * Deletes audit entries older than the retention period, in every workspace
 * and the platform's, through the database function app_prune_audit_log (row
 * security keeps the runtime role to one workspace otherwise). Returns how
 * many were deleted.
 */
export async function pruneAuditLog(now = Date.now(), days = auditRetentionDays()): Promise<number> {
  if (days === null) return 0
  const before = new Date(now - days * DAY_MS).toISOString()
  const [row] = await prisma.$queryRaw<Array<{ deleted: number }>>`
    SELECT app_prune_audit_log(${before}::timestamp) AS deleted`
  return row?.deleted ?? 0
}

let retentionTimer: NodeJS.Timeout | null = null

/** Prunes once shortly after start, then every six hours (instrumentation.ts). Instances may overlap safely. */
export function startAuditRetention() {
  if (retentionTimer || auditRetentionDays() === null) return
  const run = () =>
    pruneAuditLog()
      .then(deleted => {
        if (deleted > 0) logger.info({ deleted }, 'Pruned old audit log entries')
      })
      .catch(error => logger.error({ err: error }, 'Audit log pruning failed'))
  setTimeout(run, 60_000).unref?.()
  retentionTimer = setInterval(run, PRUNE_INTERVAL_MS)
  retentionTimer.unref?.()
}
