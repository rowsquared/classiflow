import 'server-only'
import type { CurrentUser } from '@/lib/api-auth'
import { getVisibleMembershipIds } from '@/lib/access'
import { db } from '@/lib/workspace/db'
import { validateSupervisor } from '@/lib/user-rules'

// Members of one workspace for its Team page, the queue's assignment controls
// and /api/workspaces/[workspaceId]/users. Admins see every member,
// supervisors themselves and their team, labellers only themselves.
//
// The API speaks user ids (`id` is the person's user id); memberships stay an
// implementation detail. `supervisorId` is the supervisor's user id.

const memberSelect = {
  id: true,
  role: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, username: true, email: true, name: true, mustResetPassword: true, lastLogin: true },
  },
  supervisor: { select: { user: { select: { id: true, name: true, email: true } } } },
  reports: {
    where: { status: 'active' as const },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
  },
  _count: { select: { assignments: true } },
}

type MemberRow = {
  role: 'admin' | 'supervisor' | 'labeller'
  status: 'active' | 'suspended'
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
  user: { id: string; username: string; email: string; name: string; mustResetPassword: boolean; lastLogin: Date | null }
  supervisor: { user: { id: string; name: string; email: string } } | null
  reports: Array<{ role: 'admin' | 'supervisor' | 'labeller'; user: { id: string; name: string; email: string } }>
  _count: { assignments: number }
}

function toMember(m: MemberRow) {
  return {
    id: m.user.id,
    username: m.user.username,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    status: m.status,
    supervisorId: m.supervisor?.user.id ?? null,
    supervisor: m.supervisor?.user ?? null,
    labellers: m.reports.map(r => ({ ...r.user, role: r.role })),
    mustResetPassword: m.user.mustResetPassword,
    lastLogin: m.user.lastLogin,
    lastSeenAt: m.lastSeenAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    _count: { assignedSentences: m._count.assignments },
  }
}

export async function listVisibleUsers(currentUser: CurrentUser, { includeSuspended = false } = {}) {
  const membershipIds = await getVisibleMembershipIds(currentUser)
  const rows = await db().workspaceMembership.findMany({
    where: {
      workspaceId: currentUser.workspaceId,
      ...(membershipIds === null ? {} : { id: { in: membershipIds } }),
      ...(includeSuspended ? {} : { status: 'active' as const }),
    },
    select: memberSelect,
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
  })
  return { users: rows.map(toMember) }
}

/** One member (by user id), or 'forbidden' when not visible to the caller, or null. */
export async function getVisibleUser(currentUser: CurrentUser, userId: string) {
  const membershipIds = await getVisibleMembershipIds(currentUser)
  const row = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: currentUser.workspaceId, userId } },
    select: { ...memberSelect, id: true },
  })
  if (!row) return membershipIds === null ? null : 'forbidden' as const
  if (membershipIds !== null && !membershipIds.includes(row.id)) return 'forbidden' as const
  return toMember(row)
}

/** Active membership ids of this workspace for the given user ids (order not kept). */
export async function membershipIdsForUsers(workspaceId: string, userIds: string[]) {
  const rows = await db().workspaceMembership.findMany({
    where: { workspaceId, userId: { in: userIds }, status: 'active' },
    select: { id: true, userId: true },
  })
  return new Map(rows.map(r => [r.userId, r.id]))
}

/**
 * A supervisor given as a user id, as a membership id of this workspace
 * (null for none), or `{ error }` when it is not an allowed supervisor.
 */
export async function resolveSupervisor(
  workspaceId: string,
  membershipId: string | null,
  supervisorUserId: string | null
): Promise<string | null | { error: string }> {
  if (!supervisorUserId) return null
  const supervisorMembershipId = (await membershipIdsForUsers(workspaceId, [supervisorUserId])).get(supervisorUserId)
  if (!supervisorMembershipId) return { error: 'Supervisor not found' }
  const problem = await validateSupervisor(workspaceId, membershipId, supervisorMembershipId)
  return problem ? { error: problem } : supervisorMembershipId
}
