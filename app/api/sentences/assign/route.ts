import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@/lib/generated/prisma/client'
import { forbidden, requireSession } from '@/lib/api-auth'
import { denyUnlessSentencesVisible, getVisibleUserIds } from '@/lib/access'
import { audit } from '@/lib/audit'

// Admins assign anything to anyone. Supervisors only touch records they can see
// and only assign to / unassign from themselves and users below them.

const MAX_IDS = 10000

const assignSchema = z.object({
  sentenceIds: z.array(z.string()).min(1).max(MAX_IDS),
  userIds: z.array(z.string()).min(1).max(1000)
})

const unassignSchema = z.object({
  sentenceIds: z.array(z.string()).min(1).max(MAX_IDS),
  userIds: z.array(z.string()).max(1000).optional()
})

// GET - Fetch current assignments for given sentence IDs
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession('admin', 'supervisor')
  if (error) return error

  try {
    const sentenceIdsParam = req.nextUrl.searchParams.get('sentenceIds')
    if (!sentenceIdsParam) {
      return NextResponse.json({ error: 'sentenceIds parameter required' }, { status: 400 })
    }

    const sentenceIds = sentenceIdsParam.split(',').filter(Boolean)
    if (sentenceIds.length === 0) {
      return NextResponse.json({ error: 'No sentence IDs provided' }, { status: 400 })
    }
    if (sentenceIds.length > MAX_IDS) {
      return NextResponse.json({ error: `At most ${MAX_IDS} sentence IDs` }, { status: 400 })
    }

    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied

    const teamUserIds = await getVisibleUserIds(user)
    const assignments = await prisma.sentenceAssignment.findMany({
      where: {
        sentenceId: { in: sentenceIds },
        ...(teamUserIds ? { userId: { in: teamUserIds } } : {})
      },
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
  const { user, error } = await requireSession('admin', 'supervisor')
  if (error) return error

  try {
    const validation = assignSchema.safeParse(await req.json())
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }

    const { sentenceIds, userIds } = validation.data

    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied

    const teamUserIds = await getVisibleUserIds(user)
    if (teamUserIds) {
      const team = new Set(teamUserIds)
      if (userIds.some(id => !team.has(id))) {
        return forbidden('Cannot assign to users you do not supervise')
      }
    }

    const existingUsers = await prisma.user.count({ where: { id: { in: userIds } } })
    if (existingUsers !== new Set(userIds).size) {
      return NextResponse.json({ error: 'Unknown user' }, { status: 400 })
    }

    const assignments: Prisma.SentenceAssignmentCreateManyInput[] = []
    for (const sentenceId of sentenceIds) {
      for (const userId of userIds) {
        assignments.push({ sentenceId, userId, assignedBy: user.id })
      }
    }

    // Existing (sentence, user) pairs are left as they are.
    await prisma.sentenceAssignment.createMany({ data: assignments, skipDuplicates: true })

    await audit({
      actorId: user.id, action: 'assignments.added', entityType: 'assignment', entityId: sentenceIds[0],
      payload: { records: sentenceIds.length, userIds },
    })
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
  const { user, error } = await requireSession('admin', 'supervisor')
  if (error) return error

  try {
    const validation = unassignSchema.safeParse(await req.json())
    if (!validation.success) {
      return NextResponse.json({ error: 'No sentences provided' }, { status: 400 })
    }
    const { sentenceIds, userIds } = validation.data

    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied

    const teamUserIds = await getVisibleUserIds(user)
    if (teamUserIds && userIds?.length) {
      const team = new Set(teamUserIds)
      if (userIds.some(id => !team.has(id))) {
        return forbidden('Cannot unassign users you do not supervise')
      }
    }

    // With userIds, only unassign those users. Without, unassign everyone the
    // caller may manage (all users for admins, their team for supervisors).
    const where: Prisma.SentenceAssignmentWhereInput = {
      sentenceId: { in: sentenceIds }
    }
    if (userIds && userIds.length > 0) {
      where.userId = { in: userIds }
    } else if (teamUserIds) {
      where.userId = { in: teamUserIds }
    }

    const deleted = await prisma.sentenceAssignment.deleteMany({ where })
    await audit({
      actorId: user.id, action: 'assignments.removed', entityType: 'assignment', entityId: sentenceIds[0],
      payload: { records: sentenceIds.length, userIds: userIds ?? 'all visible', removed: deleted.count },
    })

    return NextResponse.json({
      ok: true,
      unassigned: deleted.count
    })
  } catch (error) {
    console.error('Error unassigning sentences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
