import 'server-only'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/generated/prisma/client'
import type { SessionUser } from '@/lib/api-auth'
import { isLastPlatformAdmin, lockPlatformAdmins } from '@/lib/user-rules'
import { revokeSessions, setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { audit, auditInTransaction } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'
import { changeEmail, accountDeletionBlocker } from '@/lib/server/accounts'
import { mailEnabled } from '@/lib/mail/config'
import { deliverSoon, queueMail } from '@/lib/mail/outbox'

const createSchema = z.object({
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
  platformRole: z.enum(['admin', 'user']).default('user'),
  tempPassword: z.string().max(256).optional(),
  access: z.enum(['password', 'invite']).default('password')
})

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform(e => e.toLowerCase())
    .optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  newPassword: z.string().max(256).optional(),
  banned: z.boolean().optional(),
  // Sign the account out everywhere without other changes.
  revokeSessions: z.literal(true).optional()
})

export async function createGlobalAccount(req: Request, actor: SessionUser) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { email, name, platformRole, tempPassword, access } = parsed.data
  if (access === 'invite' && !mailEnabled())
    return NextResponse.json({ error: 'Email is not configured' }, { status: 409 })
  const displayUsername = parsed.data.username ?? `user_${randomUUID().replaceAll('-', '')}`
  const username = displayUsername.toLowerCase()

  const taken = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true, username: true, email: true }
  })
  // An existing email answers with that account, so the form can open it instead.
  if (taken?.email === email) {
    return NextResponse.json({ error: 'Email already in use', existingUserId: taken.id }, { status: 409 })
  }
  if (taken) return NextResponse.json({ error: 'Username already in use' }, { status: 400 })
  const weak = access === 'password' ? passwordProblem(tempPassword ?? '', { username, email, name }) : null
  if (weak) return NextResponse.json({ error: `Temporary password: ${weak}`, field: 'tempPassword' }, { status: 400 })
  try {
    const result = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          username,
          displayUsername,
          email,
          name,
          role: platformRole,
          mustResetPassword: access === 'password',
          invitedAt: access === 'invite' ? new Date() : null,
          createdById: actor.id
        },
        select: { id: true, username: true, email: true, name: true, role: true, createdAt: true }
      })
      if (access === 'password') await setPassword(tx, created.id, tempPassword!)
      const mailId =
        access === 'invite'
          ? await queueMail(tx, { userId: created.id, requestedById: actor.id, purpose: 'invitation' })
          : null
      await auditInTransaction(tx, {
        workspaceId: null,
        actorId: actor.id,
        action: 'user.created',
        entityType: 'user',
        entityId: created.id,
        payload: { username, platformRole }
      })
      return { user: created, mailId }
    })
    if (result.mailId) deliverSoon([result.mailId])
    return NextResponse.json({ user: result.user }, { status: 201 })
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
      return NextResponse.json(
        existing
          ? { error: 'Email already in use', existingUserId: existing.id }
          : { error: 'Username already in use' },
        { status: existing ? 409 : 400 }
      )
    }
    throw caught
  }
}

export async function updateGlobalAccount(req: Request, actor: SessionUser, userId: string) {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { name, email, platformRole, newPassword, banned, revokeSessions: signOutEverywhere } = parsed.data
  if (newPassword) {
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, email: true, name: true }
    })
    const weak = account && passwordProblem(newPassword, { ...account, name: name ?? account.name })
    if (weak) return NextResponse.json({ error: `New password: ${weak}`, field: 'newPassword' }, { status: 400 })
  }
  if (banned && userId === actor.id) {
    return NextResponse.json({ error: 'You cannot ban yourself' }, { status: 400 })
  }

  const result = await prisma.$transaction(async tx => {
    await lockPlatformAdmins(tx)
    const existing = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!existing) return { status: 404 as const }
    const losesAdmin = existing.role === 'admin' && (platformRole === 'user' || banned === true)
    if (losesAdmin && (await isLastPlatformAdmin(userId, tx))) return { status: 400 as const }
    let emailChange: { changed: boolean; mailId: string | null } | null = null
    if (email !== undefined) {
      const changed = await changeEmail(tx, { userId, email, actorId: actor.id, workspaceId: null })
      if ('error' in changed) return { status: 409 as const, error: changed.error }
      emailChange = changed
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(platformRole !== undefined ? { role: platformRole } : {}),
        ...(banned !== undefined ? { banned, banReason: banned ? 'Suspended by a platform admin' : null } : {}),
        // An admin-set password is temporary and ends every session.
        ...(newPassword ? { mustResetPassword: true } : {})
      }
    })
    if (newPassword) await setPassword(tx, userId, newPassword)
    if (newPassword || banned || signOutEverywhere) await revokeSessions(tx, userId)
    return { status: 200 as const, from: existing.role, emailChange }
  })
  if (result.status === 404) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (result.status === 400) {
    return NextResponse.json({ error: 'Keep at least one active platform admin' }, { status: 400 })
  }
  if (result.status === 409) return NextResponse.json({ error: result.error, field: 'email' }, { status: 400 })
  if (result.emailChange?.mailId) deliverSoon([result.emailChange.mailId])
  if (result.emailChange?.changed) {
    await audit({
      workspaceId: null,
      actorId: actor.id,
      action: 'user.email_changed',
      entityType: 'user',
      entityId: userId
    })
  }

  await audit({
    workspaceId: null,
    actorId: actor.id,
    action:
      signOutEverywhere && !name && !platformRole && !newPassword && banned === undefined
        ? 'user.sessions_revoked'
        : 'user.updated',
    entityType: 'user',
    entityId: userId,
    payload: {
      fields: Object.entries({ name, platformRole, banned })
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
      ...(platformRole && platformRole !== result.from
        ? { platformRole: { from: result.from, to: platformRole } }
        : {}),
      ...(newPassword ? { passwordReset: true } : {})
    }
  })
  return NextResponse.json({ ok: true })
}

export async function deleteGlobalAccount(actor: SessionUser, userId: string) {
  if (userId === actor.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  try {
    const deleted = await prisma.$transaction(
      async tx => {
        await lockPlatformAdmins(tx)
        const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
        if (!target) return null
        if (target.role === 'admin' && (await isLastPlatformAdmin(userId, tx))) return 'last-admin' as const
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`
        const blocker = await accountDeletionBlocker(userId)
        if (blocker) return { blocker }
        // Only empty accounts reach this point; no saved work loses its author.
        const deleted = await tx.user.delete({ where: { id: userId }, select: { username: true, role: true } })
        await auditInTransaction(tx, {
          workspaceId: null,
          actorId: actor.id,
          action: 'user.deleted',
          entityType: 'user',
          entityId: userId,
          payload: { username: deleted.username }
        })
        return deleted
      },
      { timeout: 60_000 }
    )
    if (!deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (deleted === 'last-admin')
      return NextResponse.json({ error: 'Keep at least one platform admin' }, { status: 400 })
    if ('blocker' in deleted) return NextResponse.json({ error: deleted.blocker }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (caught) {
    // A concurrent reference or an unrecognised dependency also fails closed.
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2003') {
      return NextResponse.json(
        {
          error: 'This account has saved work or dependencies. Disable it instead of deleting it.'
        },
        { status: 409 }
      )
    }
    throw caught
  }
}
