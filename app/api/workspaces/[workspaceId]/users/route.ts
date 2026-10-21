import { NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidden, workspaceRoute } from '@/lib/api-auth'
import { listVisibleUsers, resolveSupervisor } from '@/lib/server/users'
import { generateTemporaryPassword, setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'
import { db } from '@/lib/workspace/db'
import { mailEnabled } from '@/lib/mail/config'
import { deliverSoon, queueCredentialMail, queueMail, recoverOutbox, sendCredentialMailSoon } from '@/lib/mail/outbox'

// Members of one workspace. The API speaks user ids (supervisorId is the
// supervisor's user id); memberships are stored per workspace, so one person
// can have different roles and supervisors in different workspaces.

const roleSchema = z.enum(['admin', 'supervisor', 'labeller'])

const createSchema = z.object({
  // Sign-in names are case-insensitive: stored in lower case (Better Auth's username plugin).
  username: z.string().min(3).max(100).regex(USERNAME_PATTERN, 'Use letters, digits, dot, underscore or hyphen'),
  email: z
    .string()
    .email()
    .max(254)
    .transform(e => e.toLowerCase()),
  name: z.string().min(1).max(200),
  role: roleSchema,
  supervisorId: z.string().optional().nullable(),
  // How the person gets access: a temporary password the admin hands over
  // (`password`), an invitation link to choose one (`invite`), or a generated
  // temporary password sent by mail (`email_password`). The last two need mail.
  access: z.enum(['password', 'invite', 'email_password']).default('password'),
  tempPassword: z.string().max(256).optional()
})

// Adding an account that already exists elsewhere: platform admins only.
// Workspace admins invite an email address instead (../invitations), so they
// cannot probe which accounts exist or take over someone else's identity.
const addExistingSchema = z.object({
  existingUser: z.string().min(1).max(254),
  role: roleSchema,
  supervisorId: z.string().optional().nullable()
})

// GET: admins see every member (suspended ones too with ?includeSuspended=true),
// supervisors themselves and their team.
export const GET = workspaceRoute(['admin', 'supervisor'], async (req, { user }) => {
  const includeSuspended = user.role === 'admin' && new URL(req.url).searchParams.get('includeSuspended') === 'true'
  if (user.role === 'admin') await recoverOutbox()
  return NextResponse.json(await listVisibleUsers(user, { includeSuspended }))
})

// POST: create a new account with a temporary password and add it to this
// workspace, or (platform admins) add an existing account.
export const POST = workspaceRoute(['admin'], async (req, { user: actor }) => {
  const body = await req.json().catch(() => null)

  if (body && typeof body === 'object' && 'existingUser' in body) {
    if (actor.authority !== 'platform') {
      return forbidden('Only platform admins can add an existing account to a workspace')
    }
    const parsed = addExistingSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
    const identifier = parsed.data.existingUser.trim().toLowerCase()
    const account = await db().user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      select: { id: true, username: true }
    })
    if (!account) return NextResponse.json({ error: 'No account with that username or email' }, { status: 404 })
    const existing = await db().workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: account.id } },
      select: { id: true }
    })
    if (existing) return NextResponse.json({ error: 'Already a member of this workspace' }, { status: 400 })
    const supervisorMembershipId = await resolveSupervisor(actor.workspaceId, null, parsed.data.supervisorId ?? null)
    if (supervisorMembershipId !== null && typeof supervisorMembershipId === 'object')
      return NextResponse.json(supervisorMembershipId, { status: 400 })
    await db().workspaceMembership.create({
      data: {
        workspaceId: actor.workspaceId,
        userId: account.id,
        role: parsed.data.role,
        supervisorMembershipId,
        addedById: actor.id
      }
    })
    await audit({
      actorId: actor.id,
      action: 'member.added',
      entityType: 'user',
      entityId: account.id,
      payload: { username: account.username, role: parsed.data.role, existingAccount: true }
    })
    return NextResponse.json({ user: { id: account.id } }, { status: 201 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { email, name, role, supervisorId, access } = parsed.data
  const displayUsername = parsed.data.username
  const username = displayUsername.toLowerCase()
  if (access !== 'password' && !mailEnabled()) {
    return NextResponse.json({ error: 'Email is not configured; hand over a temporary password' }, { status: 400 })
  }
  // The admin's own password for `password`; generated here for
  // `email_password`, so nobody but the person ever sees it.
  let password: string | null = null
  if (access === 'password') {
    password = parsed.data.tempPassword ?? ''
    const weak = passwordProblem(password, { username, email, name })
    if (weak) return NextResponse.json({ error: `Temporary password: ${weak}`, field: 'tempPassword' }, { status: 400 })
  } else if (access === 'email_password') {
    do password = generateTemporaryPassword()
    while (passwordProblem(password, { username, email, name }))
  }

  const taken = await db().user.findFirst({ where: { OR: [{ username }, { email }] }, select: { username: true } })
  if (taken) {
    return NextResponse.json(
      {
        error:
          taken.username === username
            ? 'Username already in use'
            : 'Email already in use. If this person already has an account, invite them by email instead.'
      },
      { status: 400 }
    )
  }
  const supervisorMembershipId = await resolveSupervisor(actor.workspaceId, null, supervisorId ?? null)
  if (supervisorMembershipId !== null && typeof supervisorMembershipId === 'object')
    return NextResponse.json(supervisorMembershipId, { status: 400 })

  // An invited account has no password until the person chooses one through
  // the link, so it cannot be signed in to before then.
  const created = await db().user.create({
    data: {
      username,
      displayUsername,
      email,
      name,
      mustResetPassword: access !== 'invite',
      createdById: actor.id,
      invitedAt: access === 'invite' ? new Date() : null
    },
    select: { id: true, username: true, email: true, name: true, mustResetPassword: true, createdAt: true }
  })
  if (password) await setPassword(db(), created.id, password)
  await db().workspaceMembership.create({
    data: { workspaceId: actor.workspaceId, userId: created.id, role, supervisorMembershipId, addedById: actor.id }
  })

  let mailId: string | null = null
  if (access === 'invite') {
    mailId = await queueMail(db(), {
      purpose: 'invitation',
      userId: created.id,
      workspaceId: actor.workspaceId,
      requestedById: actor.id
    })
    deliverSoon([mailId])
  } else if (access === 'email_password' && password) {
    mailId = await queueCredentialMail(db(), {
      userId: created.id,
      workspaceId: actor.workspaceId,
      requestedById: actor.id
    })
    // Sent after the commit from memory; never stored, never retried.
    sendCredentialMailSoon([{ mailId, password }])
  }

  await audit({
    actorId: actor.id,
    action: 'user.created',
    entityType: 'user',
    entityId: created.id,
    payload: { username, role, supervisorId: supervisorId ?? null, access }
  })
  return NextResponse.json(
    {
      user: { ...created, role, supervisorId: supervisorId ?? null },
      mail: mailId ? { id: mailId, status: 'pending' } : null
    },
    { status: 201 }
  )
})
