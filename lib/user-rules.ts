import { prisma } from '@/lib/prisma'
import { getTeamMembershipIds } from '@/lib/access'
import { db } from '@/lib/workspace/db'

/**
 * Checks a proposed supervisor for `membershipId` (null for a membership being
 * created) in the current workspace transaction. Returns an error message, or
 * null when the link is allowed: the supervisor must be an active admin or
 * supervisor membership of the same workspace, and must not be the member or
 * anyone below them (which would create a cycle).
 */
export async function validateSupervisor(
  workspaceId: string,
  membershipId: string | null,
  supervisorMembershipId: string | null
): Promise<string | null> {
  if (!supervisorMembershipId) return null
  if (supervisorMembershipId === membershipId) return 'A member cannot supervise themselves'

  const supervisor = await db().workspaceMembership.findUnique({
    where: { workspaceId_id: { workspaceId, id: supervisorMembershipId } },
    select: { role: true, status: true },
  })
  if (!supervisor || supervisor.status !== 'active') return 'Supervisor not found'
  if (supervisor.role === 'labeller') return 'Supervisor must have the admin or supervisor role'

  if (membershipId) {
    const below = await getTeamMembershipIds(workspaceId, membershipId)
    if (below.includes(supervisorMembershipId)) {
      return 'That supervisor reports to this member; the change would create a cycle'
    }
  }
  return null
}

/**
 * Serialises administrator changes in one workspace: concurrent demotions or
 * suspensions wait for each other, so two admins cannot remove each other at
 * the same moment. Call at the start of the change, inside the transaction.
 */
export async function lockWorkspaceAdmins(workspaceId: string): Promise<void> {
  // An advisory lock, not a row lock: every write already holds a share lock on
  // the workspace row (lib/workspace/db.ts), and upgrading it could deadlock.
  await db().$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('classiflow.workspace_admins.' || ${workspaceId}))`
}

/** True when `membershipId` is the workspace's only active admin membership. */
export async function isLastWorkspaceAdmin(workspaceId: string, membershipId: string): Promise<boolean> {
  const admins = await db().workspaceMembership.findMany({
    where: { workspaceId, role: 'admin', status: 'active' },
    select: { id: true },
    take: 2,
  })
  return admins.length === 1 && admins[0]?.id === membershipId
}

/**
 * Serialises platform-admin changes the same way, with a transaction-level
 * advisory lock (there is no single row to lock). Use inside a transaction.
 */
export async function lockPlatformAdmins(client: { $queryRaw: typeof prisma.$queryRaw } = prisma): Promise<void> {
  await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('classiflow.platform_admins'))`
}

/** True when `userId` is the only platform admin. */
export async function isLastPlatformAdmin(
  userId: string,
  client: Pick<typeof prisma, 'user'> = prisma
): Promise<boolean> {
  const admins = await client.user.findMany({ where: { role: 'admin' }, select: { id: true }, take: 2 })
  return admins.length === 1 && admins[0]?.id === userId
}
