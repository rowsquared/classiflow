import { NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { mailEnabled } from '@/lib/mail/config'
import { deliverSoon, queueMail } from '@/lib/mail/outbox'
import { mayResendAccountInvitation } from '@/lib/server/users'
import { db } from '@/lib/workspace/db'

const bodySchema = z.object({ purpose: z.enum(['password_link', 'invitation']) })

/**
 * Platform admins send password links. Workspace admins may resend setup
 * invitations for eligible accounts in their workspace.
 */
export const POST = workspaceRoute<'userId'>(['admin'], async (req, { user: actor, params }) => {
  if (!mailEnabled()) return NextResponse.json({ error: 'Email is not configured' }, { status: 409 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  const { purpose } = parsed.data
  const userId = params.userId

  const membership = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    select: { status: true, user: { select: { banned: true, invitedAt: true, invitationAcceptedAt: true } } }
  })
  if (!membership) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (membership.status !== 'active' || membership.user.banned) {
    return NextResponse.json({ error: 'This member is not active' }, { status: 400 })
  }
  if (purpose === 'password_link' && actor.authority !== 'platform') {
    return forbidden('Only a platform admin can send an account a password link')
  }
  if (purpose === 'invitation' && !(await mayResendAccountInvitation(actor, userId))) {
    return forbidden('Only a platform admin can resend an invitation for this account')
  }
  if (purpose === 'invitation' && (!membership.user.invitedAt || membership.user.invitationAcceptedAt)) {
    return NextResponse.json({ error: 'This account has no open invitation' }, { status: 400 })
  }

  const mailId = await queueMail(db(), {
    purpose,
    userId,
    workspaceId: actor.workspaceId,
    requestedById: actor.id
  })
  await audit({
    actorId: actor.id,
    action: purpose === 'password_link' ? 'mail.password_link_requested' : 'mail.invitation_requested',
    entityType: 'user',
    entityId: userId,
    payload: { mailId, authority: actor.authority }
  })
  deliverSoon([mailId])
  return NextResponse.json({ ok: true, mail: { id: mailId, status: 'pending' } })
})
