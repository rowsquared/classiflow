import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'

// Platform administration of global accounts. Workspace membership is managed
// per workspace (/api/workspaces/[workspaceId]/users).

const createSchema = z.object({
  username: z.string().min(3).max(100).regex(USERNAME_PATTERN, 'Use letters, digits, dot, underscore or hyphen'),
  email: z.string().email().max(254).transform(e => e.toLowerCase()),
  name: z.string().min(1).max(200),
  platformRole: z.enum(['admin', 'user']).default('user'),
  tempPassword: z.string().max(256),
})

export async function GET() {
  const { error } = await requirePlatformAdmin()
  if (error) return error

  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, email: true, name: true, role: true, banned: true,
      mustResetPassword: true, lastLogin: true, createdAt: true,
      memberships: {
        select: { role: true, status: true, workspace: { select: { id: true, name: true } } },
        orderBy: { workspace: { name: 'asc' } },
      },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({
    users: users.map(({ role, ...u }) => ({ ...u, platformRole: role })),
  })
}

export async function POST(req: Request) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { email, name, platformRole, tempPassword } = parsed.data
  const displayUsername = parsed.data.username
  const username = displayUsername.toLowerCase()
  const weak = passwordProblem(tempPassword, { username, email, name })
  if (weak) return NextResponse.json({ error: `Temporary password: ${weak}`, field: 'tempPassword' }, { status: 400 })

  const taken = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] }, select: { username: true } })
  if (taken) {
    return NextResponse.json({ error: taken.username === username ? 'Username already in use' : 'Email already in use' }, { status: 400 })
  }
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: { username, displayUsername, email, name, role: platformRole, mustResetPassword: true },
      select: { id: true, username: true, email: true, name: true, role: true, createdAt: true },
    })
    await setPassword(tx, created.id, tempPassword)
    return created
  })
  await audit({
    workspaceId: null, actorId: actor.id, action: 'user.created', entityType: 'user', entityId: user.id,
    payload: { username, platformRole },
  })
  return NextResponse.json({ user }, { status: 201 })
}
