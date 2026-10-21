import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { mailEnabled } from '@/lib/mail/config'
import { resendInvitation, revokeInvitation } from '@/lib/server/invitations'

// POST: send the invitation again with a new link (workspace admins only).
export const POST = workspaceRoute<'invitationId'>(['admin'], async (_req, { user, params }) => {
  if (!mailEnabled()) return NextResponse.json({ error: 'Email is not configured' }, { status: 409 })
  if (!(await resendInvitation(user, params.invitationId))) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
})

// DELETE: withdraw an open invitation; its link stops working.
export const DELETE = workspaceRoute<'invitationId'>(['admin'], async (_req, { user, params }) => {
  if (!(await revokeInvitation(user, params.invitationId))) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
})
