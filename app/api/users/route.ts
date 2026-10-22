import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { passwordProblem } from '@/lib/password-policy'
import { globalUsersQuery } from '@/lib/contracts/users'
import { parseQuery } from '@/lib/contracts/progress'
import { listGlobalUsers } from '@/lib/server/global-users'

// Platform administration of global accounts. Workspace membership is managed
// per workspace (/api/workspaces/[workspaceId]/users).

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
  tempPassword: z.string().max(256)
})

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const query = parseQuery(globalUsersQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  return NextResponse.json(await listGlobalUsers(query.data))
}

export async function POST(req: Request) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { email, name, platformRole, tempPassword } = parsed.data
  const displayUsername = parsed.data.username ?? `user_${randomUUID().replaceAll('-', '')}`
  const username = displayUsername.toLowerCase()
  const weak = passwordProblem(tempPassword, { username, email, name })
  if (weak) return NextResponse.json({ error: `Temporary password: ${weak}`, field: 'tempPassword' }, { status: 400 })

  const taken = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true, username: true, email: true }
  })
  // An existing email answers with that account, so the form can open it instead.
  if (taken?.email === email) {
    return NextResponse.json({ error: 'Email already in use', existingUserId: taken.id }, { status: 409 })
  }
  if (taken) return NextResponse.json({ error: 'Username already in use' }, { status: 400 })
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {
        username,
        displayUsername,
        email,
        name,
        role: platformRole,
        mustResetPassword: true,
        createdById: actor.id
      },
      select: { id: true, username: true, email: true, name: true, role: true, createdAt: true }
    })
    await setPassword(tx, created.id, tempPassword)
    return created
  })
  await audit({
    workspaceId: null,
    actorId: actor.id,
    action: 'user.created',
    entityType: 'user',
    entityId: user.id,
    payload: { username, platformRole }
  })
  return NextResponse.json({ user }, { status: 201 })
}
