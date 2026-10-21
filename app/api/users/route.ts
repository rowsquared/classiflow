import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { listVisibleUsers } from '@/lib/server/users'
import { validateSupervisor } from '@/lib/user-rules'
import { setPassword, USERNAME_PATTERN } from '@/lib/passwords'
import { z } from 'zod'
import { audit } from '@/lib/audit'

const createUserSchema = z.object({
  // Sign-in names are case-insensitive: stored in lower case (Better Auth's username plugin).
  username: z.string().min(3).max(100).regex(USERNAME_PATTERN, 'Use letters, digits, dot, underscore or hyphen')
    .transform(u => u.toLowerCase()),
  email: z.string().email().max(254).transform(e => e.toLowerCase()),
  name: z.string().min(1).max(200),
  role: z.enum(['admin', 'supervisor', 'labeller']),
  supervisorId: z.string().optional().nullable(),
  tempPassword: z.string().min(8).max(256)
})

// GET - List users: all for admins, themselves and their team for supervisors
export async function GET() {
  const { user: currentUser, error } = await requireSession('admin', 'supervisor')
  if (error) return error

  try {
    return NextResponse.json(await listVisibleUsers(currentUser))
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create new user
export async function POST(req: NextRequest) {
  const { user: actor, error } = await requireSession('admin')
  if (error) return error

  try {
    const body = await req.json()
    const validation = createUserSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json({ 
        error: 'Invalid request data',
        details: validation.error.issues 
      }, { status: 400 })
    }

    const { username, email, name, role, supervisorId, tempPassword } = validation.data

    // Check if username or email already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    })

    if (existingUser) {
      if (existingUser.username === username) {
        return NextResponse.json({ error: 'Username already in use' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const supervisorError = await validateSupervisor(null, supervisorId || null)
    if (supervisorError) {
      return NextResponse.json({ error: supervisorError }, { status: 400 })
    }

    // The user and their temporary password (a Better Auth credential account).
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          username,
          displayUsername: validation.data.username,
          email,
          name,
          role,
          supervisorId: supervisorId || null,
          mustResetPassword: true
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          supervisorId: true,
          mustResetPassword: true,
          createdAt: true
        }
      })
      await setPassword(tx, created.id, tempPassword)
      return created
    })

    await audit({
      actorId: actor.id, action: 'user.created', entityType: 'user', entityId: user.id,
      payload: { username: user.username, role: user.role, supervisorId: user.supervisorId },
    })
    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

