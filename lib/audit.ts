import type { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Audit trail of administrative and access-relevant events, stored in
 * AuditLog and listed to admins at /admin/audit.
 *
 * Recorded: user, taxonomy, import, assignment, bulk-label, export and AI job
 * changes, and refused access (`access.denied`). Not recorded: individual label
 * saves, comments and flags; those rows carry their own author and timestamps.
 *
 * Payloads hold identifiers, counts and changed field names only, never record
 * text, label values beyond codes, or passwords.
 *
 * Writing is best effort and happens after the change committed: a failure is
 * logged and never fails the request.
 */

export type AuditAction =
  | 'user.created' | 'user.updated' | 'user.deleted' | 'user.password_changed'
  | 'taxonomy.created' | 'taxonomy.updated' | 'taxonomy.deleted' | 'taxonomy.imported'
  | 'taxonomy.restored' | 'taxonomy.ai_sync_started'
  | 'records.imported' | 'import.deleted'
  | 'assignments.added' | 'assignments.removed'
  | 'labels.bulk_applied'
  | 'export.downloaded'
  | 'ai.labeling_started' | 'ai.learning_started' | 'ai.job_cancelled'
  | 'access.denied'

export type AuditEntry = {
  actorId: string | null
  action: AuditAction
  entityType: string
  entityId: string
  payload?: Prisma.InputJsonValue
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const actorName = entry.actorId
      ? (await prisma.user.findUnique({ where: { id: entry.actorId }, select: { username: true } }))?.username ?? null
      : null
    await prisma.auditLog.create({ data: { ...entry, actorName } })
  } catch (error) {
    console.error(`[audit] could not record ${entry.action} on ${entry.entityType} ${entry.entityId}:`, error)
  }
}
