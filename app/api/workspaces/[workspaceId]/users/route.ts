import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listVisibleUsers } from '@/lib/server/users'
import { recoverOutbox } from '@/lib/mail/outbox'
import { createMember } from '@/lib/server/member-create'

// GET: admins see every member (suspended ones too with ?includeSuspended=true),
// supervisors themselves and their team.
export const GET = workspaceRoute(['admin', 'supervisor'], async (req, { user }) => {
  const includeSuspended = user.role === 'admin' && new URL(req.url).searchParams.get('includeSuspended') === 'true'
  if (user.role === 'admin') await recoverOutbox()
  return NextResponse.json(await listVisibleUsers(user, { includeSuspended }))
})

// POST: create a new account with a temporary password and add it to this
// workspace, or (platform admins) add an existing account.
export const POST = workspaceRoute(['admin'], async (req, { user: actor }) => createMember(req, actor))
