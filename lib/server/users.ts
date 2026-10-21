import 'server-only'
import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'

// Users for the Team page (app/admin/team), the queue's assignment controls
// and /api/users. Admins see everyone, supervisors themselves and their team,
// labellers only themselves.

export async function listVisibleUsers(currentUser: CurrentUser) {
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

  return { users }
}

/** One user with their team and activity counts, or 'forbidden' when not visible to the caller. */
export async function getVisibleUser(currentUser: CurrentUser, userId: string) {
  const visibleUserIds = await getVisibleUserIds(currentUser)
  if (visibleUserIds && !visibleUserIds.includes(userId)) {
    return 'forbidden' as const
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

  return user
}
