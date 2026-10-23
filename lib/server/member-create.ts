import 'server-only'
import { addExistingMember } from '@/lib/server/memberships'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CurrentUser } from '@/lib/api-auth'
import { resolveSupervisor } from '@/lib/server/users'
import { generateTemporaryPassword, setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'
import { db } from '@/lib/workspace/db'
import { mailEnabled } from '@/lib/mail/config'
import { deliverSoon, queueCredentialMail, queueMail, sendCredentialMailSoon } from '@/lib/mail/outbox'

const roleSchema = z.enum(['admin', 'supervisor', 'labeller'])

const createSchema = z.object({
  // Sign-in names are case-insensitive: stored in lower case (Better Auth's username plugin).
  username: z
    .string()
    .min(3)
    .max(100)
    .regex(USERNAME_PATTERN, 'Use letters, digits, dot, underscore or hyphen')
    .optional(),
  email: z
    .string()
    .trim()
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
const addExistingSchema = z
  .object({
    existingUser: z.string().min(1).max(254).optional(),
    existingUserId: z.string().min(1).max(100).optional(),
    role: roleSchema,
    supervisorId: z.string().optional().nullable()
  })
  .refine(value => !!value.existingUser !== !!value.existingUserId, 'Choose one user identifier')

export async function createMember(req: Request, actor: CurrentUser) {
  const body = await req.json().catch(() => null)

  if (body && typeof body === 'object' && ('existingUser' in body || 'existingUserId' in body)) {
    const parsed = addExistingSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    const result = await addExistingMember(actor, parsed.data)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ user: { id: result.userId } }, { status: result.status })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { email, name, role, supervisorId, access } = parsed.data
  const displayUsername = parsed.data.username ?? `user_${randomUUID().replaceAll('-', '')}`
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
          actor.authority !== 'platform'
            ? 'Could not create this account. Invite by email or ask a platform administrator for help.'
            : taken.username === username
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
}
