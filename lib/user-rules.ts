import { prisma } from '@/lib/prisma'
import { getTeamUserIds } from '@/lib/access'

/**
 * Checks a proposed supervisor for `userId` (null for a user being created).
 * Returns an error message, or null when the link is allowed: the supervisor
 * must exist, be an admin or supervisor, and must not be the user or anyone
 * below them (which would create a cycle).
 */
export async function validateSupervisor(userId: string | null, supervisorId: string | null): Promise<string | null> {
  if (!supervisorId) return null
  if (supervisorId === userId) return 'A user cannot supervise themselves'

  const supervisor = await prisma.user.findUnique({
    where: { id: supervisorId },
    select: { role: true },
  })
  if (!supervisor) return 'Supervisor not found'
  if (supervisor.role === 'labeller') return 'Supervisor must have the admin or supervisor role'

  if (userId) {
    const below = await getTeamUserIds(userId)
    if (below.includes(supervisorId)) {
      return 'That supervisor reports to this user; the change would create a cycle'
    }
  }
  return null
}

/** True when `userId` is the only admin, so demoting or deleting them would lock everyone out. */
export async function isLastAdmin(userId: string): Promise<boolean> {
  const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true }, take: 2 })
  return admins.length === 1 && admins[0].id === userId
}
