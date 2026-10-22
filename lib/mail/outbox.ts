import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { MailPurpose, Prisma } from '@/lib/generated/prisma/client'
import { issueAccountLink, deleteExpiredAccountLinks } from '@/lib/account-links'
import { runAfterResponse } from '@/lib/after-response'
import { audit, type AuditAction } from '@/lib/audit'
import { mailConfig, mailEnabled } from './config'
import { sendMail, type MailOutcome } from './transport'
import {
  credentialsMail,
  emailChangedMail,
  invitationMail,
  passwordChangedMail,
  passwordLinkMail,
  workspaceInvitationMail,
  type MailTemplate
} from './templates'
import { logger } from '@/lib/logger'

/**
 * The outbox (OutgoingMail): one row per mail, metadata only. A mail is queued
 * in the same transaction as the change that causes it, and sent after the
 * response (lib/after-response.ts), once that transaction has committed:
 *
 * 1. claim: `pending → sending` in one conditional UPDATE, so two instances
 *    (or a delivery and the recovery) can never both send a row;
 * 2. build the message at send time: links are minted then, so nothing secret
 *    ever sits in the table;
 * 3. record sent / failed / unknown (lib/mail/n8n.ts).
 *
 * Rows left `sending` (the server stopped mid-send) become `unknown` and are
 * never resent automatically. Rows left `pending` are picked up by
 * recoverOutbox(). Generated passwords (`credentials`) never go through this
 * path: see sendCredentialMail().
 */

type MailDb = Pick<Prisma.TransactionClient, 'outgoingMail'>

export type QueueInput = {
  purpose: Exclude<MailPurpose, 'credentials'>
  userId?: string | null
  workspaceId?: string | null
  invitationId?: string | null
  /** Only for a notice to an address the account no longer has. */
  recipient?: string | null
  requestedById?: string | null
}

/** Queues a mail in `client`'s transaction; returns its id. */
export async function queueMail(client: MailDb, input: QueueInput): Promise<string> {
  const row = await client.outgoingMail.create({
    data: {
      purpose: input.purpose,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      invitationId: input.invitationId ?? null,
      recipient: input.recipient ?? null,
      requestedById: input.requestedById ?? null
    },
    select: { id: true }
  })
  return row.id
}

/** Sends the queued mails after the response (and after the current transaction commits). */
export function deliverSoon(ids: string[]) {
  if (ids.length === 0) return
  runAfterResponse(() => deliverMail(ids))
}

const CONCURRENCY = 2

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))
  }
}

type ClaimedRow = {
  id: string
  purpose: MailPurpose
  userId: string | null
  workspaceId: string | null
  invitationId: string | null
  recipient: string | null
  requestedById: string | null
}

const claimedSelect = {
  id: true,
  purpose: true,
  userId: true,
  workspaceId: true,
  invitationId: true,
  recipient: true,
  requestedById: true
} as const

/** Claims and sends the given pending mails (not credentials). */
export async function deliverMail(ids: string[]): Promise<void> {
  const claimed = await prisma.outgoingMail.updateManyAndReturn({
    where: { id: { in: ids }, status: 'pending', purpose: { not: 'credentials' } },
    data: { status: 'sending', claimedAt: new Date(), attempts: { increment: 1 } },
    select: claimedSelect
  })
  await inBatches(claimed, async row => {
    let result: MailOutcome
    try {
      const built = await buildMessage(row)
      result = 'skip' in built ? { outcome: 'failed', detail: built.skip } : await sendMail(built)
    } catch (error) {
      // The message only: the error must not carry the mail's content.
      logger.error(
        { purpose: row.purpose, mailId: row.id, error: error instanceof Error ? error.message : String(error) },
        'Could not send mail'
      )
      result = { outcome: 'unknown', detail: 'Unexpected error while sending' }
    }
    await recordOutcome(row, result)
  })
}

type Built = (MailTemplate & { to: string }) | { skip: string }

async function buildMessage(row: ClaimedRow): Promise<Built> {
  const config = mailConfig()
  const base = config.baseUrl
  if (!base) return { skip: 'No public URL configured for links' }

  if (row.purpose === 'workspace_invitation') {
    const invitation = row.invitationId
      ? await prisma.workspaceInvitation.findUnique({
          where: { id: row.invitationId },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            workspace: { select: { name: true, status: true } }
          }
        })
      : null
    if (!invitation || invitation.status !== 'pending') return { skip: 'The invitation is no longer open' }
    if (invitation.workspace.status !== 'active') return { skip: 'The workspace is archived' }
    // A new secret per mail: the latest link replaces older ones.
    const secret = randomBytes(32).toString('base64url')
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: createHash('sha256').update(secret).digest('hex'),
        expiresAt: new Date(Date.now() + config.invitationHours * 3600_000)
      }
    })
    return {
      to: invitation.email,
      ...workspaceInvitationMail({
        workspaceName: invitation.workspace.name,
        role: invitation.role,
        url: `${base}/invitation#t=${invitation.id}.${secret}`,
        hours: config.invitationHours
      })
    }
  }

  const user = row.userId
    ? await prisma.user.findUnique({
        where: { id: row.userId },
        select: { id: true, username: true, email: true, name: true, banned: true, invitationAcceptedAt: true }
      })
    : null
  if (!user) return { skip: 'The account no longer exists' }
  if (user.banned && row.purpose !== 'email_changed') return { skip: 'The account is suspended' }

  switch (row.purpose) {
    case 'invitation': {
      if (user.invitationAcceptedAt) return { skip: 'The invitation was already used' }
      const membership = row.workspaceId
        ? await prisma.workspaceMembership.findUnique({
            where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: user.id } },
            select: { role: true, workspace: { select: { name: true } } }
          })
        : null
      const token = await issueAccountLink(prisma, {
        userId: user.id,
        email: user.email,
        purpose: 'invitation',
        ttlMs: config.invitationHours * 3600_000
      })
      return {
        to: user.email,
        ...invitationMail({
          name: user.name,
          username: user.username,
          workspaceName: membership?.workspace.name ?? null,
          role: membership?.role ?? null,
          url: `${base}/set-password#t=${token}`,
          hours: config.invitationHours
        })
      }
    }
    case 'password_link': {
      const token = await issueAccountLink(prisma, {
        userId: user.id,
        email: user.email,
        purpose: 'password_link',
        ttlMs: config.passwordLinkMinutes * 60_000
      })
      return {
        to: user.email,
        ...passwordLinkMail({
          name: user.name,
          username: user.username,
          url: `${base}/set-password#t=${token}`,
          minutes: config.passwordLinkMinutes
        })
      }
    }
    case 'password_changed':
      return {
        to: user.email,
        ...passwordChangedMail({ name: user.name, username: user.username, signInUrl: `${base}/login` })
      }
    case 'email_changed':
      if (!row.recipient) return { skip: 'No previous address recorded' }
      return { to: row.recipient, ...emailChangedMail({ username: user.username }) }
    default:
      return { skip: 'Not sent through the outbox' }
  }
}

const OUTCOME_ACTION: Record<MailOutcome['outcome'], AuditAction> = {
  sent: 'mail.sent',
  failed: 'mail.failed',
  unknown: 'mail.unknown'
}

async function recordOutcome(row: ClaimedRow, result: MailOutcome) {
  await prisma.outgoingMail.update({
    where: { id: row.id },
    data: {
      status: result.outcome,
      detail: result.detail ?? null,
      sentAt: result.outcome === 'sent' ? new Date() : null
    }
  })
  // Mail an admin asked for is audited (ids and outcome only); self-service
  // requests (forgotten passwords) are not.
  if (row.requestedById) {
    await audit({
      workspaceId: row.workspaceId,
      actorId: row.requestedById,
      action: OUTCOME_ACTION[result.outcome],
      entityType: row.invitationId ? 'invitation' : 'user',
      entityId: row.invitationId ?? row.userId ?? row.id,
      payload: { mailId: row.id, purpose: row.purpose }
    })
  }
}

/**
 * A generated temporary password by mail. The caller creates the account and
 * this metadata-only row in one transaction; the password stays in memory
 * and is sent by sendCredentialMailSoon() after that commit. Never retried:
 * a row that never reached `sending` is marked as not sent by the recovery,
 * and an `unknown` one may have arrived, so the remedy is a password link or
 * a new temporary password, never sending the old one again.
 */
export async function queueCredentialMail(
  client: MailDb,
  input: { userId: string; workspaceId: string | null; requestedById: string | null }
): Promise<string> {
  const row = await client.outgoingMail.create({
    data: { purpose: 'credentials', ...input },
    select: { id: true }
  })
  return row.id
}

export function sendCredentialMailSoon(items: Array<{ mailId: string; password: string }>) {
  if (items.length === 0) return
  runAfterResponse(() => inBatches(items, item => sendCredentialMail(item.mailId, item.password)))
}

async function sendCredentialMail(mailId: string, password: string) {
  const [row] = await prisma.outgoingMail.updateManyAndReturn({
    where: { id: mailId, status: 'pending', purpose: 'credentials' },
    data: { status: 'sending', claimedAt: new Date(), attempts: { increment: 1 } },
    select: claimedSelect
  })
  if (!row) return
  let result: MailOutcome
  try {
    const base = mailConfig().baseUrl
    const user = row.userId
      ? await prisma.user.findUnique({
          where: { id: row.userId },
          select: { username: true, email: true, name: true, banned: true }
        })
      : null
    const membership =
      row.workspaceId && row.userId
        ? await prisma.workspaceMembership.findUnique({
            where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: row.userId } },
            select: { role: true, workspace: { select: { name: true } } }
          })
        : null
    if (!base || !user || user.banned) {
      result = { outcome: 'failed', detail: 'Not sent: the account or the public URL is unavailable' }
    } else {
      result = await sendMail({
        to: user.email,
        ...credentialsMail({
          name: user.name,
          username: user.username,
          password,
          workspaceName: membership?.workspace.name ?? null,
          role: membership?.role ?? null,
          signInUrl: `${base}/login`
        })
      })
    }
  } catch {
    // Deliberately no error detail: it could contain the message.
    result = { outcome: 'unknown', detail: 'Unexpected error while sending' }
  }
  await recordOutcome(row, result)
}

const RECOVERY_INTERVAL_MS = 60_000
const PRUNE_INTERVAL_MS = 60 * 60_000
let lastRecovery = 0
let lastPrune = 0

/**
 * Deletes finished rows (sent, failed, unknown) older than
 * MAIL_RETENTION_DAYS (default 90; 0 keeps them). They only serve the recent
 * mail status on the Team page and the resend cooldown; the audit log keeps
 * the mail events. Queued and sending rows are never pruned. Returns the
 * number of rows deleted.
 */
export async function pruneOutbox(now = Date.now()): Promise<number> {
  const days = mailConfig().retentionDays
  if (days === null) return 0
  const result = await prisma.outgoingMail.deleteMany({
    where: {
      status: { in: ['sent', 'failed', 'unknown'] },
      createdAt: { lt: new Date(now - days * 24 * 60 * 60_000) }
    }
  })
  return result.count
}

/**
 * Rows a stopped server left behind: `sending` past the transport timeout
 * becomes `unknown`; unsent credential rows are marked as not sent (the
 * password is gone); other `pending` rows are sent; old finished rows are
 * pruned (at most hourly, pruneOutbox). At most once a minute per
 * instance unless forced. Called on a timer (instrumentation.ts) and from the
 * Team page's member list.
 */
export async function recoverOutbox({ force = false } = {}): Promise<void> {
  if (!force && Date.now() - lastRecovery < RECOVERY_INTERVAL_MS) return
  lastRecovery = Date.now()
  const config = mailConfig()
  const now = Date.now()
  await prisma.outgoingMail.updateMany({
    where: { status: 'sending', claimedAt: { lt: new Date(now - config.timeoutMs - 60_000) } },
    data: { status: 'unknown', detail: 'The server stopped while sending; the message may have been sent' }
  })
  await prisma.outgoingMail.updateMany({
    where: { status: 'pending', purpose: 'credentials', createdAt: { lt: new Date(now - 5 * 60_000) } },
    data: { status: 'failed', detail: 'Not sent: the server stopped before sending. Send a password link instead.' }
  })
  await deleteExpiredAccountLinks(prisma)
  if (force || now - lastPrune >= PRUNE_INTERVAL_MS) {
    lastPrune = now
    const pruned = await pruneOutbox(now)
    if (pruned > 0) logger.info({ pruned }, 'Pruned old outgoing mail rows')
  }
  if (!mailEnabled()) return
  const pending = await prisma.outgoingMail.findMany({
    where: { status: 'pending', purpose: { not: 'credentials' }, createdAt: { lt: new Date(now - 60_000) } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 50
  })
  // Sent in the background: callers may hold a request (or a transaction) open.
  if (pending.length) deliverSoon(pending.map(p => p.id))
}

let timer: NodeJS.Timeout | null = null

/** Runs recoverOutbox() every minute in this instance (instrumentation.ts). */
export function startOutboxRecovery() {
  if (timer) return
  timer = setInterval(() => {
    recoverOutbox().catch(error => logger.error({ err: error }, 'Mail outbox recovery failed'))
  }, RECOVERY_INTERVAL_MS)
  timer.unref?.()
}
