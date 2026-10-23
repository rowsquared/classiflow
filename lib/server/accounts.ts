import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma/client'
import { findAccountLink, invalidateAccountLinks, parseLinkToken, type LinkPurpose } from '@/lib/account-links'
import { checkPassword, revokeSessions, setPassword } from '@/lib/passwords'
import { passwordProblem } from '@/lib/password-policy'
import { auditInTransaction } from '@/lib/audit'
import { mailEnabled } from '@/lib/mail/config'
import { deliverMail, deliverSoon, queueMail } from '@/lib/mail/outbox'
import { db, withWorkspace } from '@/lib/workspace/db'

// Account flows behind the public password pages (U7b/U7c) and email changes
// (U3). Accounts are global (control plane), so these use the plain client.

/** One self-service password link per account per this period, across instances. */
export const PASSWORD_LINK_COOLDOWN_MS = 15 * 60_000

export async function sendAdminPasswordLink(userId: string, actorId: string) {
  if (!mailEnabled()) return { ok: false, error: 'Email is not configured' }
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { banned: true, invitedAt: true, invitationAcceptedAt: true }
  })
  if (!account) return null
  if (account.banned) return { ok: false, error: 'Enable the account before sending a password link' }
  const id = await prisma.$transaction(async tx => {
    const mailId = await queueMail(tx, {
      userId,
      requestedById: actorId,
      purpose: account.invitedAt && !account.invitationAcceptedAt ? 'invitation' : 'password_link'
    })
    await auditInTransaction(tx, {
      workspaceId: null,
      actorId,
      action: 'mail.password_link_requested',
      entityType: 'user',
      entityId: userId
    })
    return mailId
  })
  deliverSoon([id])
  return { ok: true }
}

/** Inspect saved work through every workspace's RLS scope; an unscoped relation count would miss it. */
export async function accountDeletionBlocker(userId: string): Promise<string | null> {
  if (await prisma.workspaceMembership.count({ where: { userId, status: 'active' } }))
    return 'Remove active workspace access before deleting this account.'
  if (await prisma.auditLog.count({ where: { actorId: userId, workspaceId: null } }))
    return 'Disable the account instead: it has saved history.'
  const workspaces = await prisma.workspace.findMany({ select: { id: true } })
  for (const workspace of workspaces) {
    const saved = await withWorkspace(workspace.id, async () => {
      const [row] = await db().$queryRaw<Array<{ saved: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "SentenceAnnotation" WHERE "workspaceId" = ${workspace.id} AND "createdById" = ${userId}
          UNION ALL SELECT 1 FROM "Comment" WHERE "workspaceId" = ${workspace.id} AND "authorId" = ${userId}
          UNION ALL SELECT 1 FROM "LabelingActivity" WHERE "workspaceId" = ${workspace.id} AND "actorId" = ${userId}
          UNION ALL SELECT 1 FROM "AuditLog" WHERE "workspaceId" = ${workspace.id} AND "actorId" = ${userId}
          UNION ALL SELECT 1 FROM "SentenceImport" WHERE "workspaceId" = ${workspace.id} AND "uploadedById" = ${userId}
          UNION ALL SELECT 1 FROM "Sentence" WHERE "workspaceId" = ${workspace.id} AND "lastEditorId" = ${userId}
          UNION ALL SELECT 1 FROM "AILabelingJob" WHERE "workspaceId" = ${workspace.id} AND "createdById" = ${userId}
          UNION ALL SELECT 1 FROM "AILearningJob" WHERE "workspaceId" = ${workspace.id} AND "createdById" = ${userId}
          UNION ALL SELECT 1 FROM "AITaxonomySyncJob" WHERE "workspaceId" = ${workspace.id} AND "createdById" = ${userId}
          UNION ALL SELECT 1 FROM "DoubleTask" WHERE "workspaceId" = ${workspace.id} AND "assigneeId" = ${userId}
          UNION ALL SELECT 1 FROM "DoubleOutcome" WHERE "workspaceId" = ${workspace.id} AND "reviewedById" = ${userId}
          UNION ALL SELECT 1 FROM "DoubleRound" WHERE "workspaceId" = ${workspace.id} AND ("createdById" = ${userId} OR "closedById" = ${userId})
          UNION ALL SELECT 1 FROM "SentenceAssignment" a JOIN "WorkspaceMembership" m ON a."membershipId" = m.id
            WHERE a."workspaceId" = ${workspace.id} AND m."userId" = ${userId}
        ) AS saved`
      return row?.saved
    })
    if (saved) return 'Disable the account instead: it has saved work, history or assignments.'
  }
  return null
}

/**
 * Forgotten password: runs after the response, so neither the answer nor its
 * timing shows whether the address has an account. Active accounts whose
 * stored email matches get a link at that stored address, at most once per
 * cooldown period (a definite failure frees the slot; an unknown one does not).
 */
export async function requestPasswordLink(email: string): Promise<void> {
  if (!mailEnabled()) return
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, banned: true }
  })
  if (!user || user.banned) return
  const mailId = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('classiflow.password_link.' || ${user.id}))`
    const recent = await tx.outgoingMail.count({
      where: {
        userId: user.id,
        purpose: 'password_link',
        status: { not: 'failed' },
        createdAt: { gt: new Date(Date.now() - PASSWORD_LINK_COOLDOWN_MS) }
      }
    })
    if (recent > 0) return null
    return queueMail(tx, { purpose: 'password_link', userId: user.id })
  })
  if (mailId) await deliverMail([mailId])
}

export type LinkCheck = { username: string; email: string; purpose: LinkPurpose }

/** Whether a link is good, without using it up (mail scanners open links). */
export async function checkAccountLink(token: unknown): Promise<LinkCheck | null> {
  const parsed = parseLinkToken(token)
  if (!parsed) return null
  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { username: true, email: true, banned: true }
  })
  if (!user || user.banned) return null
  const link = await findAccountLink(prisma, token, user.email)
  return link ? { username: user.username, email: user.email, purpose: link.purpose } : null
}

export type ConfirmResult =
  { ok: true; username: string; email: string } | { ok: false; status: number; error: string; field?: 'newPassword' }

const INVALID = { ok: false as const, status: 400, error: 'This link is invalid, used or expired' }

/**
 * Sets the password from a link, in one transaction with the user row locked,
 * so two confirmations of one link cannot both succeed: the link is checked
 * again, the password policy applies (and the current password is refused),
 * every link and session of the account ends, the reset flag is cleared, and
 * a "password changed" notice is queued (not for a new account's first
 * password). The person then signs in with the new password.
 */
export async function confirmAccountLink(token: unknown, newPassword: string): Promise<ConfirmResult> {
  const parsed = parseLinkToken(token)
  if (!parsed) return INVALID
  const outcome = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "User" WHERE id = ${parsed.userId} FOR UPDATE`
    if (locked.length === 0) return INVALID
    const user = await tx.user.findUniqueOrThrow({
      where: { id: parsed.userId },
      select: { id: true, username: true, email: true, name: true, banned: true, invitationAcceptedAt: true }
    })
    if (user.banned) return INVALID
    const link = await findAccountLink(tx, token, user.email)
    if (!link) return INVALID
    const weak = passwordProblem(newPassword, user)
    if (weak) return { ok: false as const, status: 400, error: weak, field: 'newPassword' as const }
    if (await checkPassword(tx, user.id, newPassword)) {
      return {
        ok: false as const,
        status: 400,
        error: 'Choose a password different from the current one',
        field: 'newPassword' as const
      }
    }
    await setPassword(tx, user.id, newPassword)
    await revokeSessions(tx, user.id)
    await tx.user.update({
      where: { id: user.id },
      data: {
        mustResetPassword: false,
        ...(link.purpose === 'invitation' && !user.invitationAcceptedAt ? { invitationAcceptedAt: new Date() } : {})
      }
    })
    await auditInTransaction(tx, {
      workspaceId: null,
      actorId: user.id,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: user.id,
      payload: { via: link.purpose }
    })
    const notice =
      link.purpose === 'password_link' && mailEnabled()
        ? await queueMail(tx, { purpose: 'password_changed', userId: user.id })
        : null
    return { ok: true as const, username: user.username, email: user.email, notice }
  })
  if (!outcome.ok) return outcome
  if (outcome.notice) deliverSoon([outcome.notice])
  return { ok: true, username: outcome.username, email: outcome.email }
}

type EmailDb = Pick<Prisma.TransactionClient, 'user' | 'verification' | 'outgoingMail'>

/**
 * Changes an account's email address (already lower case and validated):
 * unique among accounts, open password links end (they were sent to the old
 * address), and when mail is on the old address gets a notice. Returns the
 * notice's mail id (deliver it after commit), null, or an error.
 */
export async function changeEmail(
  client: EmailDb,
  input: { userId: string; email: string; actorId: string; workspaceId: string | null }
): Promise<{ error: string } | { changed: boolean; mailId: string | null }> {
  const user = await client.user.findUnique({ where: { id: input.userId }, select: { email: true } })
  if (!user) return { error: 'User not found' }
  if (user.email === input.email) return { changed: false, mailId: null }
  const taken = await client.user.findUnique({ where: { email: input.email }, select: { id: true } })
  if (taken) return { error: 'Email already in use' }
  await client.user.update({ where: { id: input.userId }, data: { email: input.email } })
  await invalidateAccountLinks(client, input.userId)
  const mailId = mailEnabled()
    ? await queueMail(client, {
        purpose: 'email_changed',
        userId: input.userId,
        recipient: user.email,
        workspaceId: input.workspaceId,
        requestedById: input.actorId
      })
    : null
  return { changed: true, mailId }
}
