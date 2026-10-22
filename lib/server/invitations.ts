import { Prisma } from '@/lib/generated/prisma/client'
import { hashPassword, setPasswordHash } from '@/lib/passwords'
import { passwordProblem } from '@/lib/password-policy'
import 'server-only'
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { CurrentUser, Role, SessionUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { mailConfig } from '@/lib/mail/config'
import { deliverSoon, queueMail } from '@/lib/mail/outbox'
import { db, withWorkspace, WorkspaceArchivedError } from '@/lib/workspace/db'
import { validateSupervisor } from '@/lib/user-rules'
import { resolveSupervisor } from '@/lib/server/users'

// Workspace invitations (P4 / U7b): a workspace admin invites an email
// address. The answer and the mail are the same whether or not an account uses
// that address, so inviting reveals nothing about other accounts. Accepting
// needs the matching account (or token-gated new-account setup) and re-checks the inviter,
// the workspace and the role at that moment. Inviting never creates, resets
// or mails a password.

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  mails: {
    select: { status: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1
  }
}

type InvitationRow = {
  id: string
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'revoked'
  expiresAt: Date
  createdAt: Date
  mails: Array<{ status: string; createdAt: Date }>
}

function toInvitation(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expired: row.status === 'pending' && row.expiresAt.getTime() < Date.now(),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    mailStatus: row.mails[0]?.status ?? null
  }
}

export type Invitation = ReturnType<typeof toInvitation>

/** Open invitations of the current workspace (inside its transaction). */
export async function listInvitations(workspaceId: string) {
  const rows = await db().workspaceInvitation.findMany({
    where: { workspaceId, status: 'pending' },
    select: invitationSelect,
    orderBy: { createdAt: 'desc' }
  })
  return rows.map(toInvitation)
}

/**
 * Creates (or renews) the invitation for `email` and queues its mail, inside
 * the workspace transaction. An address that already has an active
 * membership here is refused: admins see their own members anyway.
 */
export async function inviteToWorkspace(
  actor: CurrentUser,
  input: { email: string; role: Role; supervisorId: string | null }
): Promise<{ error: string } | { invitation: Invitation }> {
  const member = await db().workspaceMembership.findFirst({
    where: { workspaceId: actor.workspaceId, status: 'active', user: { email: input.email } },
    select: { id: true }
  })
  if (member) return { error: 'Already a member of this workspace' }
  const supervisor = await resolveSupervisor(actor.workspaceId, null, input.supervisorId)
  if (supervisor !== null && typeof supervisor === 'object') return supervisor
  const { id, mailId } = await createInvitation(actor, {
    email: input.email,
    role: input.role,
    supervisorMembershipId: supervisor
  })
  deliverSoon([mailId])
  const invitation = await db().workspaceInvitation.findUniqueOrThrow({ where: { id }, select: invitationSelect })
  return { invitation: toInvitation(invitation) }
}

/**
 * Creates or renews the invitation for `email` and queues its mail, inside
 * the workspace transaction. The caller checks membership and the supervisor
 * and delivers the mail after the commit (`deliverSoon`).
 */
export async function createInvitation(
  actor: CurrentUser,
  input: { email: string; role: Role; supervisorMembershipId: string | null }
): Promise<{ id: string; mailId: string }> {
  const expiresAt = new Date(Date.now() + mailConfig().invitationHours * 3600_000)
  const existing = await db().workspaceInvitation.findFirst({
    where: { workspaceId: actor.workspaceId, email: input.email, status: 'pending' },
    select: { id: true }
  })
  const data = {
    role: input.role,
    supervisorMembershipId: input.supervisorMembershipId,
    invitedById: actor.id,
    expiresAt,
    tokenHash: null
  }
  const row = existing
    ? await db().workspaceInvitation.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db().workspaceInvitation.create({
        data: { workspaceId: actor.workspaceId, email: input.email, ...data },
        select: { id: true }
      })
  const mailId = await queueMail(db(), {
    purpose: 'workspace_invitation',
    invitationId: row.id,
    workspaceId: actor.workspaceId,
    requestedById: actor.id
  })
  await audit({
    actorId: actor.id,
    action: 'member.invited',
    entityType: 'invitation',
    entityId: row.id,
    payload: { role: input.role, renewed: !!existing, authority: actor.authority }
  })
  return { id: row.id, mailId }
}

export async function revokeInvitation(actor: CurrentUser, invitationId: string): Promise<boolean> {
  const { count } = await db().workspaceInvitation.updateMany({
    where: { id: invitationId, workspaceId: actor.workspaceId, status: 'pending' },
    data: { status: 'revoked', tokenHash: null }
  })
  if (count === 0) return false
  await audit({
    actorId: actor.id,
    action: 'member.invitation_revoked',
    entityType: 'invitation',
    entityId: invitationId,
    payload: { authority: actor.authority }
  })
  return true
}

/** Sends the invitation again with a new link (older links stop working). */
export async function resendInvitation(actor: CurrentUser, invitationId: string): Promise<boolean> {
  const invitation = await db().workspaceInvitation.findFirst({
    where: { id: invitationId, workspaceId: actor.workspaceId, status: 'pending' },
    select: { id: true }
  })
  if (!invitation) return false
  const mailId = await queueMail(db(), {
    purpose: 'workspace_invitation',
    invitationId,
    workspaceId: actor.workspaceId,
    requestedById: actor.id
  })
  await audit({
    actorId: actor.id,
    action: 'mail.invitation_requested',
    entityType: 'invitation',
    entityId: invitationId,
    payload: { mailId, authority: actor.authority }
  })
  deliverSoon([mailId])
  return true
}

function parseToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const match = /^([a-z0-9]{10,40})\.([A-Za-z0-9_-]{32,64})$/.exec(token)
  return match ? { id: match[1]!, secret: match[2]! } : null
}

function secretMatches(tokenHash: string | null, secret: string) {
  if (!tokenHash) return false
  const a = Buffer.from(tokenHash, 'hex')
  const b = createHash('sha256').update(secret).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}

/** An open, unexpired invitation for this token (control plane read). */
async function findOpenInvitation(token: unknown) {
  const parsed = parseToken(token)
  if (!parsed) return null
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { id: parsed.id },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      tokenHash: true,
      workspace: { select: { name: true, status: true } }
    }
  })
  if (!invitation || invitation.status !== 'pending' || invitation.expiresAt.getTime() < Date.now()) return null
  if (!secretMatches(invitation.tokenHash, parsed.secret)) return null
  return invitation
}

export type InvitationCheck = {
  workspaceName: string
  role: Role
  archived: boolean
  /** Null when nobody is signed in. */
  matchesAccount: boolean | null
}

/** What the invitation page shows. Only the link's holder learns the workspace. */
export async function checkInvitation(token: unknown, user: SessionUser | null): Promise<InvitationCheck | null> {
  const invitation = await findOpenInvitation(token)
  if (!invitation) return null
  let matchesAccount: boolean | null = null
  if (user) {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })
    matchesAccount = account?.email === invitation.email
  }
  return {
    workspaceName: invitation.workspace.name,
    role: invitation.role,
    archived: invitation.workspace.status !== 'active',
    matchesAccount
  }
}

export type AcceptResult = { ok: true; workspaceId: string } | { ok: false; status: number; error: string }

const GONE = { ok: false as const, status: 404, error: 'This invitation is invalid, used or expired' }

/**
 * Accepts an invitation for the signed-in account, in the workspace's
 * transaction with the invitation row locked (a second acceptance waits and
 * then finds it used). Re-checks at this moment: the address matches the
 * account, the workspace is active, and the inviter is still an admin of it
 * (or a platform admin). The supervisor is kept only if still allowed.
 */
export async function acceptInvitation(token: unknown, user: SessionUser): Promise<AcceptResult> {
  const found = await findOpenInvitation(token)
  if (!found) return GONE
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, banned: true } })
  if (!account || account.banned) return GONE
  if (account.email !== found.email) {
    return {
      ok: false,
      status: 403,
      error: 'This invitation was sent to a different email address. Sign in with that account to accept it.'
    }
  }
  const parsed = parseToken(token)!
  try {
    return await withWorkspace(found.workspaceId, () => acceptInside(found, parsed, user), { write: true })
  } catch (caught) {
    if (caught instanceof WorkspaceArchivedError) {
      return { ok: false, status: 409, error: 'This workspace is archived; the invitation cannot be accepted' }
    }
    throw caught
  }
}

async function acceptInside(
  found: NonNullable<Awaited<ReturnType<typeof findOpenInvitation>>>,
  parsed: NonNullable<ReturnType<typeof parseToken>>,
  user: SessionUser
): Promise<AcceptResult> {
  const [invitation] = await db().$queryRaw<
    Array<{
      status: string
      expiresAt: Date
      tokenHash: string | null
      role: Role
      supervisorMembershipId: string | null
      invitedById: string | null
    }>
  >`SELECT status, "expiresAt", "tokenHash", role, "supervisorMembershipId", "invitedById"
          FROM "WorkspaceInvitation" WHERE id = ${found.id} FOR UPDATE`
  if (
    !invitation ||
    invitation.status !== 'pending' ||
    invitation.expiresAt.getTime() < Date.now() ||
    !secretMatches(invitation.tokenHash, parsed.secret)
  ) {
    return GONE
  }
  if (!(await inviterStillAdmin(found.workspaceId, invitation.invitedById))) {
    return { ok: false, status: 409, error: 'This invitation is no longer valid. Ask an admin for a new one.' }
  }
  const membership = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: found.workspaceId, userId: user.id } },
    select: { id: true, status: true }
  })
  if (membership?.status === 'active') {
    await markAccepted(found.id, user.id)
    return { ok: true, workspaceId: found.workspaceId }
  }
  const supervisorOk =
    invitation.supervisorMembershipId &&
    !(await validateSupervisor(found.workspaceId, membership?.id ?? null, invitation.supervisorMembershipId))
  const data = {
    role: invitation.role,
    status: 'active' as const,
    supervisorMembershipId: supervisorOk ? invitation.supervisorMembershipId : null,
    addedById: invitation.invitedById
  }
  if (membership) {
    await db().workspaceMembership.update({ where: { id: membership.id }, data })
  } else {
    await db().workspaceMembership.create({ data: { workspaceId: found.workspaceId, userId: user.id, ...data } })
  }
  await markAccepted(found.id, user.id)
  await audit({
    actorId: user.id,
    action: membership ? 'member.reactivated' : 'member.added',
    entityType: 'user',
    entityId: user.id,
    payload: { role: invitation.role, via: 'invitation', invitationId: found.id }
  })
  return { ok: true, workspaceId: found.workspaceId }
}

/** Only a valid invitation can create an account; never replace an existing identity's credentials. */
export async function setupInvitedAccount(token: unknown, name: string, password: string): Promise<AcceptResult> {
  const found = await findOpenInvitation(token)
  if (!found) return GONE
  const username = `user_${randomUUID().replaceAll('-', '')}`
  const weak = passwordProblem(password, { username, email: found.email, name })
  if (weak) return { ok: false, status: 400, error: weak }
  const hash = await hashPassword(password)
  try {
    return await withWorkspace(
      found.workspaceId,
      async () => {
        // Serialize setup for this email across workspaces. Uniqueness also protects other creators.
        await db()
          .$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('classiflow.identity.' || ${found.email}))`
        const existing = await db().user.findUnique({ where: { email: found.email }, select: { id: true } })
        if (existing)
          return {
            ok: false as const,
            status: 409,
            error: 'An account already uses this email. Sign in to accept the invitation.'
          }
        // Validate acceptance before creating anything. A thrown refusal rolls back the new account too.
        const user = await db().user.create({
          data: {
            username,
            displayUsername: username,
            email: found.email,
            name,
            mustResetPassword: false,
            invitedAt: new Date(),
            invitationAcceptedAt: new Date()
          },
          select: { id: true }
        })
        await setPasswordHash(db(), user.id, hash)
        const result = await acceptInside(found, parseToken(token)!, { id: user.id, platformRole: 'user' })
        if (!result.ok) throw new InvitationSetupError(result)
        return result
      },
      { write: true }
    )
  } catch (error) {
    if (error instanceof InvitationSetupError) return error.result
    if (error instanceof WorkspaceArchivedError) return { ok: false, status: 409, error: 'This workspace is archived' }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return { ok: false, status: 409, error: 'An account already uses this email. Sign in to accept the invitation.' }
    throw error
  }
}

class InvitationSetupError extends Error {
  constructor(readonly result: AcceptResult) {
    super('Invitation setup refused')
  }
}

async function markAccepted(invitationId: string, userId: string) {
  await db().workspaceInvitation.update({
    where: { id: invitationId },
    data: { status: 'accepted', acceptedAt: new Date(), acceptedById: userId, tokenHash: null }
  })
}

async function inviterStillAdmin(workspaceId: string, inviterId: string | null): Promise<boolean> {
  if (!inviterId) return false
  const inviter = await db().user.findUnique({
    where: { id: inviterId },
    select: {
      role: true,
      banned: true,
      memberships: { where: { workspaceId, status: 'active', role: 'admin' }, select: { id: true } }
    }
  })
  if (!inviter || inviter.banned) return false
  return inviter.role === 'admin' || inviter.memberships.length > 0
}
