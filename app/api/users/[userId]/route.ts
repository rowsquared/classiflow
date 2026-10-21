import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { forbidden, requireSession } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'
import { isLastAdmin, validateSupervisor } from '@/lib/user-rules'
import { audit } from '@/lib/audit'

const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.enum(['admin', 'supervisor', 'labeller']).optional(),
  supervisorId: z.string().nullable().optional(),
  newPassword: z.string().min(8).max(256).optional()
})

// GET - Get single user: admins see anyone, supervisors their team, everyone themselves
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const { user: currentUser, error } = await requireSession()
  if (error) return error

  try {
    const { userId } = await context.params

    const visibleUserIds = await getVisibleUserIds(currentUser)
    if (visibleUserIds && !visibleUserIds.includes(userId)) {
      return forbidden()
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
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
            email: true,
            role: true
          }
        },
        mustResetPassword: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            assignedSentences: true,
            editedSentences: true,
            annotations: true,
            comments: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error fetching user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Update user (admins only)
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const { user: actor, error } = await requireSession('admin')
  if (error) return error

  try {
    const { userId } = await context.params

    const body = await req.json()
    const validation = updateUserSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({
        error: 'Invalid request data',
        details: validation.error.issues
      }, { status: 400 })
    }

    const { name, role, supervisorId, newPassword } = validation.data

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, supervisorId: true } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (role !== undefined && role !== 'admin' && existing.role === 'admin' && await isLastAdmin(userId)) {
      return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
    }

    if (supervisorId !== undefined) {
      const supervisorError = await validateSupervisor(userId, supervisorId)
      if (supervisorError) {
        return NextResponse.json({ error: supervisorError }, { status: 400 })
      }
    }

    // Build update data
    const updateData: Prisma.UserUncheckedUpdateInput = {}
    if (name !== undefined) updateData.name = name
    if (role !== undefined) updateData.role = role
    if (supervisorId !== undefined) updateData.supervisorId = supervisorId

    // An admin-set password is temporary: the user must change it, and every
    // session signed in with the old password ends.
    if (newPassword) {
      updateData.password = await bcrypt.hash(newPassword, 10)
      updateData.mustResetPassword = true
      updateData.sessionVersion = { increment: 1 }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        supervisorId: true,
        mustResetPassword: true,
        updatedAt: true
      }
    })

    await audit({
      actorId: actor.id, action: 'user.updated', entityType: 'user', entityId: userId,
      payload: {
        fields: Object.keys(updateData).filter(k => k !== 'mustResetPassword' && k !== 'sessionVersion'),
        ...(role !== undefined && role !== existing.role ? { role: { from: existing.role, to: role } } : {}),
        ...(supervisorId !== undefined && supervisorId !== existing.supervisorId
          ? { supervisor: { from: existing.supervisorId, to: supervisorId } } : {}),
        ...(newPassword ? { passwordReset: true } : {}),
      },
    })
    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete user (admins only)
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const { user: currentUser, error } = await requireSession('admin')
  if (error) return error

  try {
    const { userId } = await context.params

    // Prevent self-deletion (which also guarantees an admin remains)
    if (userId === currentUser.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Comments and AI jobs keep their author (restrict foreign keys), so a user
    // who has any cannot be deleted without losing that history.
    const [comments, aiJobs] = await Promise.all([
      prisma.comment.count({ where: { authorId: userId } }),
      prisma.$transaction([
        prisma.aILabelingJob.count({ where: { createdById: userId } }),
        prisma.aILearningJob.count({ where: { createdById: userId } }),
        prisma.aIExternalTrainingJob.count({ where: { createdById: userId } }),
      ]).then(counts => counts.reduce((a, b) => a + b, 0)),
    ])
    if (comments > 0 || aiJobs > 0) {
      return NextResponse.json({
        error: `This user wrote ${comments} comment(s) and started ${aiJobs} AI job(s), which keep their author. ` +
          'Remove their assignments and change their password instead of deleting the account.'
      }, { status: 409 })
    }

    // Delete user: assignments cascade; their annotations, imports and last-edit
    // markers keep the data but lose the user reference (set null).
    const deleted = await prisma.user.delete({
      where: { id: userId },
      select: { username: true, role: true },
    })
    await audit({
      actorId: currentUser.id, action: 'user.deleted', entityType: 'user', entityId: userId,
      payload: { username: deleted.username, role: deleted.role },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
