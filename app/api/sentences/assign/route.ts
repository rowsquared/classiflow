import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

const assignSchema = z.object({
  sentenceIds: z.array(z.string()).min(1),
  userIds: z.array(z.string()).min(1)
})

// GET - Fetch current assignments for given sentence IDs
export async function GET(req: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.user.role !== 'admin' && session.user.role !== 'supervisor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sentenceIdsParam = req.nextUrl.searchParams.get('sentenceIds')
    if (!sentenceIdsParam) {
      return NextResponse.json({ error: 'sentenceIds parameter required' }, { status: 400 })
    }

    const sentenceIds = sentenceIdsParam.split(',').filter(Boolean)
    if (sentenceIds.length === 0) {
      return NextResponse.json({ error: 'No sentence IDs provided' }, { status: 400 })
    }

    const assignments = await prisma.sentenceAssignment.findMany({
      where: { sentenceId: { in: sentenceIds } },
      select: {
        sentenceId: true,
        userId: true
      }
    })

    // Return a map of userId -> list of sentenceIds they're assigned to
    const userAssignments: Record<string, string[]> = {}
    for (const a of assignments) {
      if (!userAssignments[a.userId]) {
        userAssignments[a.userId] = []
      }
      userAssignments[a.userId].push(a.sentenceId)
    }

    return NextResponse.json({ ok: true, userAssignments })
  } catch (error) {
    console.error('Error fetching assignments:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admins and supervisors can assign sentences
    if (session.user.role !== 'admin' && session.user.role !== 'supervisor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const validation = assignSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json({ 
        error: 'Invalid request data'
      }, { status: 400 })
    }

    const { sentenceIds, userIds } = validation.data

    // For supervisors, verify they can only assign to users they supervise
    if (session.user.role === 'supervisor') {
      // Get all users this supervisor can assign to (direct labellers + supervised supervisors' labellers)
      const supervisor = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
          labellers: {
            include: {
              labellers: true // Nested - get labellers of supervised supervisors
            }
          }
        }
      })

      if (!supervisor) {
        return NextResponse.json({ error: 'Supervisor not found' }, { status: 404 })
      }

      // Build list of assignable user IDs
      const assignableUserIds = new Set<string>([session.user.id]) // Can assign to self
      supervisor.labellers.forEach(labeller => {
        assignableUserIds.add(labeller.id)
        // Add nested labellers (if this labeller is also a supervisor)
        labeller.labellers.forEach(nestedLabeller => {
          assignableUserIds.add(nestedLabeller.id)
        })
      })

      // Check all requested userIds are assignable
      const invalidUsers = userIds.filter(id => !assignableUserIds.has(id))
      if (invalidUsers.length > 0) {
        return NextResponse.json({ 
          error: 'Cannot assign to users you do not supervise' 
        }, { status: 403 })
      }
    }

    // Create assignments (using upsert to handle duplicates gracefully)
    const assignments = []
    for (const sentenceId of sentenceIds) {
      for (const userId of userIds) {
        assignments.push({
          sentenceId,
          userId,
          assignedBy: session.user.id
        })
      }
    }

    // Use transaction to create all assignments
    await prisma.$transaction(
      assignments.map(assignment =>
        prisma.sentenceAssignment.upsert({
          where: {
            sentenceId_userId: {
              sentenceId: assignment.sentenceId,
              userId: assignment.userId
            }
          },
          create: assignment,
          update: {} // If exists, do nothing
        })
      )
    )

    return NextResponse.json({ 
      ok: true, 
      assigned: assignments.length,
      sentences: sentenceIds.length,
      users: userIds.length
    })
  } catch (error) {
    console.error('Error assigning sentences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Unassign sentences
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admins and supervisors can unassign
    if (session.user.role !== 'admin' && session.user.role !== 'supervisor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { sentenceIds, userIds } = body as { sentenceIds: string[], userIds?: string[] }

    if (!sentenceIds || sentenceIds.length === 0) {
      return NextResponse.json({ error: 'No sentences provided' }, { status: 400 })
    }

    // If userIds provided, only unassign from those users
    // Otherwise, unassign from all users
    const where: Prisma.SentenceAssignmentWhereInput = {
      sentenceId: { in: sentenceIds }
    }

    if (userIds && userIds.length > 0) {
      where.userId = { in: userIds }
    }

    const deleted = await prisma.sentenceAssignment.deleteMany({ where })

    return NextResponse.json({ 
      ok: true, 
      unassigned: deleted.count 
    })
  } catch (error) {
    console.error('Error unassigning sentences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

