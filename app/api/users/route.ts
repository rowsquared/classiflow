import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'labeller']),
  supervisorId: z.string().optional().nullable(),
  tempPassword: z.string().min(8)
})

// GET - List all users
export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admin and supervisors can view users
    if (session.user.role !== 'admin' && session.user.role !== 'supervisor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const users = await prisma.user.findMany({
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
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admins can create users
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

