import { NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { getVisibleUser, mayManageAccount, resolveSupervisor } from '@/lib/server/users'
import { isLastWorkspaceAdmin, lockWorkspaceAdmins } from '@/lib/user-rules'
import { revokeSessions, setPassword } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { db } from '@/lib/workspace/db'
import { passwordProblem } from '@/lib/password-policy'
import { changeEmail } from '@/lib/server/accounts'
import { deliverSoon } from '@/lib/mail/outbox'

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform(e => e.toLowerCase())
    .optional(),
  role: z.enum(['admin', 'supervisor', 'labeller']).optional(),
  supervisorId: z.string().nullable().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  newPassword: z.string().max(256).optional()
})

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
export const PUT = workspaceRoute<'userId'>(['admin'], async (req, { user: actor, params }) => {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { name, email, role, supervisorId, status, newPassword } = parsed.data
  const userId = params.userId

  await lockWorkspaceAdmins(actor.workspaceId)
  const membership = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    select: { id: true, role: true, status: true, supervisorMembershipId: true }
  })
  if (!membership) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const losesAdmin =
    membership.role === 'admin' &&
    membership.status === 'active' &&
    ((role !== undefined && role !== 'admin') || status === 'suspended')
  if (losesAdmin && (await isLastWorkspaceAdmin(actor.workspaceId, membership.id))) {
    return NextResponse.json({ error: 'Cannot demote or suspend the last admin of this workspace' }, { status: 400 })
  }
  if (status === 'suspended' && userId === actor.id) {
    return NextResponse.json({ error: 'You cannot suspend yourself' }, { status: 400 })
  }
  if ((name !== undefined || email !== undefined || newPassword) && !(await mayManageAccount(actor, userId))) {
    return forbidden(
      'This account is used beyond this workspace; only a platform admin can change its name, email or password'
    )
  }

  if (newPassword) {
    const account = await db().user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, email: true, name: true }
    })
    const weak = passwordProblem(newPassword, { ...account, name: name ?? account.name })
    if (weak) return NextResponse.json({ error: `New password: ${weak}`, field: 'newPassword' }, { status: 400 })
  }

  // First of the writes, so a taken address refuses the whole request. Open
  // password links end (they went to the old address); the old address gets
  // a notice when mail is on.
  let emailChanged = false
  if (email !== undefined) {
    const result = await changeEmail(db(), { userId, email, actorId: actor.id, workspaceId: actor.workspaceId })
    if ('error' in result) return NextResponse.json({ error: result.error, field: 'email' }, { status: 400 })
    emailChanged = result.changed
    if (result.mailId) deliverSoon([result.mailId])
  }

  let supervisorMembershipId: string | null | undefined
  if (supervisorId !== undefined) {
    const resolved = await resolveSupervisor(actor.workspaceId, membership.id, supervisorId)
    if (resolved !== null && typeof resolved === 'object') return NextResponse.json(resolved, { status: 400 })
    supervisorMembershipId = resolved
  }

  await db().workspaceMembership.update({
    where: { id: membership.id },
    data: {
      ...(role !== undefined ? { role } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(supervisorMembershipId !== undefined ? { supervisorMembershipId } : {})
    }
  })
  // A suspended member no longer supervises anyone here.
  if (status === 'suspended') {
    await db().workspaceMembership.updateMany({
      where: { supervisorMembershipId: membership.id },
      data: { supervisorMembershipId: null }
    })
  }
  if (name !== undefined) await db().user.update({ where: { id: userId }, data: { name } })

  // An admin-set password is temporary: the user must change it, and every
  // session signed in with the old password ends.
  if (newPassword) {
    await setPassword(db(), userId, newPassword)
    await revokeSessions(db(), userId)
    await db().user.update({ where: { id: userId }, data: { mustResetPassword: true } })
  }

  if (emailChanged) {
    await audit({
      actorId: actor.id,
      action: 'user.email_changed',
      entityType: 'user',
      entityId: userId,
      payload: { authority: actor.authority }
    })
  }
  const fields = Object.entries({ name, role, supervisorId, status })
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
  await audit({
    actorId: actor.id,
    action:
      status === 'suspended'
        ? 'member.suspended'
        : status === 'active' && membership.status === 'suspended'
          ? 'member.reactivated'
          : 'member.updated',
    entityType: 'user',
    entityId: userId,
    payload: {
      fields,
      ...(role !== undefined && role !== membership.role ? { role: { from: membership.role, to: role } } : {}),
      ...(newPassword ? { passwordReset: true } : {}),
      authority: actor.authority
    }
  })

  const member = await getVisibleUser({ ...actor, role: 'admin' }, userId)
  return NextResponse.json({ user: member })
})

// DELETE: removes the person from this workspace by suspending the membership.
// Their labels, comments and history stay; the account itself is untouched.
// Body `{ unassignOpen: true }` also drops their assignments on records that
// are not submitted, so the work can be given to someone else.
export const DELETE = workspaceRoute<'userId'>(['admin'], async (req, { user: actor, params }) => {
  const userId = params.userId
  const body = (await req.json().catch(() => ({}))) as { unassignOpen?: unknown }
  const unassignOpen = body?.unassignOpen === true
  if (userId === actor.id) {
    return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 })
  }
  await lockWorkspaceAdmins(actor.workspaceId)
  const membership = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    select: { id: true, role: true, status: true }
  })
  if (!membership) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (
    membership.role === 'admin' &&
    membership.status === 'active' &&
    (await isLastWorkspaceAdmin(actor.workspaceId, membership.id))
  ) {
    return NextResponse.json({ error: 'Cannot remove the last admin of this workspace' }, { status: 400 })
  }
  await db().workspaceMembership.update({ where: { id: membership.id }, data: { status: 'suspended' } })
  await db().workspaceMembership.updateMany({
    where: { supervisorMembershipId: membership.id },
    data: { supervisorMembershipId: null }
  })
  const unassigned = unassignOpen
    ? (
        await db().sentenceAssignment.deleteMany({
          where: { membershipId: membership.id, sentence: { status: { not: 'submitted' } } }
        })
      ).count
    : 0
  await audit({
    actorId: actor.id,
    action: 'member.suspended',
    entityType: 'user',
    entityId: userId,
    payload: { role: membership.role, authority: actor.authority, unassigned }
  })
  return NextResponse.json({ ok: true })
})
