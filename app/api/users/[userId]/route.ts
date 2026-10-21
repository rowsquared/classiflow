import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/generated/prisma/client'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { isLastPlatformAdmin, lockPlatformAdmins } from '@/lib/user-rules'
import { revokeSessions, setPassword } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'

// Platform administration of one global account: name, platform role,
// temporary password, ban, deletion. Workspace roles live on memberships.

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  newPassword: z.string().max(256).optional(),
  banned: z.boolean().optional(),
  // Sign the account out everywhere without other changes.
  revokeSessions: z.literal(true).optional()
})

type Params = { params: Promise<{ userId: string }> }

export async function PUT(req: Request, { params }: Params) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const { userId } = await params

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { name, platformRole, newPassword, banned, revokeSessions: signOutEverywhere } = parsed.data
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
    return { status: 200 as const, from: existing.role }
  })
  if (result.status === 404) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (result.status === 400) {
    return NextResponse.json({ error: 'Keep at least one active platform admin' }, { status: 400 })
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

export async function DELETE(_req: Request, { params }: Params) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const { userId } = await params
  if (userId === actor.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  try {
    const deleted = await prisma.$transaction(async tx => {
      await lockPlatformAdmins(tx)
      const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
      if (!target) return null
      if (target.role === 'admin' && (await isLastPlatformAdmin(userId, tx))) return 'last-admin' as const
      // Memberships and sessions go with the account; labels, imports and edit
      // markers keep their data without the author. Comments and AI jobs keep
      // their author, so an account that has any cannot be deleted (below).
      return tx.user.delete({ where: { id: userId }, select: { username: true, role: true } })
    })
    if (!deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (deleted === 'last-admin')
      return NextResponse.json({ error: 'Keep at least one platform admin' }, { status: 400 })
    await audit({
      workspaceId: null,
      actorId: actor.id,
      action: 'user.deleted',
      entityType: 'user',
      entityId: userId,
      payload: { username: deleted.username, platformRole: deleted.role }
    })
    return NextResponse.json({ ok: true })
  } catch (caught) {
    // Comments and AI jobs reference their author with a restricting foreign
    // key; the workspace tables are not readable here, so let the database say so.
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2003') {
      return NextResponse.json(
        {
          error:
            'This account wrote comments or started AI jobs, which keep their author. ' +
            'Ban it or remove it from its workspaces instead of deleting it.'
        },
        { status: 409 }
      )
    }
    throw caught
  }
}
