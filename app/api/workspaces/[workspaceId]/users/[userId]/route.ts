import { NextResponse } from 'next/server'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { getVisibleUser } from '@/lib/server/users'
import { updateMembership, removeMembership } from '@/lib/server/memberships'

// GET: admins see any member, supervisors their team, everyone themselves.
export const GET = workspaceRoute<'userId'>([], async (_req, { user: currentUser, params }) => {
  const member =
    currentUser.id === params.userId
      ? await getVisibleUser({ ...currentUser, role: 'admin' }, params.userId)
      : await getVisibleUser(currentUser, params.userId)
  if (member === 'forbidden') return forbidden()
  if (!member) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ user: member })
})

// PUT: role, supervisor and status are this workspace's; name, email and
// password are the account's (see mayManageAccount).
export const PUT = workspaceRoute<'userId'>(['admin'], async (req, { user: actor, params }) =>
  updateMembership(req, actor, params.userId)
)

// DELETE: removes the person from this workspace by suspending the membership.
// Their labels, comments and history stay; the account itself is untouched.
// Body `{ unassignOpen: true }` also drops their assignments on records that
// are not submitted, so the work can be given to someone else.
export const DELETE = workspaceRoute<'userId'>(['admin'], async (req, { user: actor, params }) =>
  removeMembership(req, actor, params.userId)
)
