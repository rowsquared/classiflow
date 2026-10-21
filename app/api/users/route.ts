import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'
import { validateSupervisor } from '@/lib/user-rules'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { audit } from '@/lib/audit'

const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  email: z.string().email().max(254),
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
    const teamUserIds = await getVisibleUserIds(currentUser)
    const users = await prisma.user.findMany({
      where: teamUserIds ? { id: { in: teamUserIds } } : undefined,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        supervisorId: true,
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        labellers: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        mustResetPassword: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            assignedSentences: true
          }
        }
      },
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ]
    })

    return NextResponse.json({ users })
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

    // Hash password
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        name,
        role,
        password: hashedPassword,
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

