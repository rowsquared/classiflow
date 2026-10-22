import 'server-only'
import type { CurrentUser } from '@/lib/api-auth'
import { getVisibleMembershipIds } from '@/lib/access'
import { db } from '@/lib/workspace/db'
import { validateSupervisor } from '@/lib/user-rules'
import type { MemberExportRow } from '@/lib/member-export'

// Members of one workspace for its Team page, the queue's assignment controls
// and /api/workspaces/[workspaceId]/users. Admins see every member,
// supervisors themselves and their team, labellers only themselves.
//
// The API speaks user ids (`id` is the person's user id); memberships stay an
// implementation detail. `supervisorId` is the supervisor's user id.

const memberSelect = (workspaceId: string) => ({
  id: true,
  role: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  addedBy: { select: { name: true, username: true } },
  user: {
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      mustResetPassword: true,
      lastLogin: true,
      createdAt: true,
      invitedAt: true,
      invitationAcceptedAt: true,
      // The latest mail sent to them from this workspace (not their self-service links).
      outgoingMails: {
        where: { workspaceId },
        select: { purpose: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1
      }
    }
  },
  supervisor: { select: { user: { select: { id: true, name: true, email: true } } } },
  reports: {
    where: { status: 'active' as const },
    select: { role: true, user: { select: { id: true, name: true, email: true } } }
  },
  _count: { select: { assignments: true } }
})

type MemberRow = {
  role: 'admin' | 'supervisor' | 'labeller'
  status: 'active' | 'suspended'
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
  addedBy: { name: string; username: string } | null
  user: {
    id: string
    username: string
    email: string
    name: string
    mustResetPassword: boolean
    lastLogin: Date | null
    createdAt: Date
    invitedAt: Date | null
    invitationAcceptedAt: Date | null
    outgoingMails: Array<{ purpose: string; status: string; createdAt: Date }>
  }
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
    addedBy: m.addedBy ? m.addedBy.name || m.addedBy.username : null,
    accountCreatedAt: m.user.createdAt,
    // Created with an invitation link and no password chosen yet.
    invitationPending: !!m.user.invitedAt && !m.user.invitationAcceptedAt,
    lastMail: m.user.outgoingMails[0] ?? null,
    _count: { assignedSentences: m._count.assignments }
  }
}

export async function listVisibleUsers(currentUser: CurrentUser, { includeSuspended = false } = {}) {
  const membershipIds = await getVisibleMembershipIds(currentUser)
  const rows = await db().workspaceMembership.findMany({
    where: {
      workspaceId: currentUser.workspaceId,
      ...(membershipIds === null ? {} : { id: { in: membershipIds } }),
      ...(includeSuspended ? {} : { status: 'active' as const })
    },
    select: memberSelect(currentUser.workspaceId),
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }]
  })
  return { users: rows.map(toMember) }
}

/** One member (by user id), or 'forbidden' when not visible to the caller, or null. */
export async function getVisibleUser(currentUser: CurrentUser, userId: string) {
  const membershipIds = await getVisibleMembershipIds(currentUser)
  const row = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: currentUser.workspaceId, userId } },
    select: memberSelect(currentUser.workspaceId)
  })
  if (!row) return membershipIds === null ? null : ('forbidden' as const)
  if (membershipIds !== null && !membershipIds.includes(row.id)) return 'forbidden' as const
  return toMember(row)
}

/** Active membership ids of this workspace for the given user ids (order not kept). */
export async function membershipIdsForUsers(workspaceId: string, userIds: string[]) {
  const rows = await db().workspaceMembership.findMany({
    where: { workspaceId, userId: { in: userIds }, status: 'active' },
    select: { id: true, userId: true }
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

/**
 * Whether a workspace admin may change this account's global profile or
 * password: platform admins always; otherwise only for an account that
 * belongs to this workspace alone and has never signed in (a new account
 * this workspace created). Anything else would let one workspace's admin take
 * over a person's access to other workspaces.
 */
export async function mayManageAccount(actor: CurrentUser, userId: string): Promise<boolean> {
  if (actor.authority === 'platform') return true
  const account = await db().user.findUnique({
    where: { id: userId },
    select: { lastLogin: true, role: true, _count: { select: { memberships: true } } }
  })
  return !!account && account.role !== 'admin' && account.lastLogin === null && account._count.memberships === 1
}

/** Every member of the workspace, suspended ones included, for the admin's CSV export. */
export async function membersForExport(workspaceId: string): Promise<MemberExportRow[]> {
  const rows = await db().workspaceMembership.findMany({
    where: { workspaceId },
    select: {
      role: true,
      status: true,
      createdAt: true,
      lastSeenAt: true,
      user: {
        select: {
          username: true,
          email: true,
          name: true,
          mustResetPassword: true,
          lastLogin: true,
          invitedAt: true,
          invitationAcceptedAt: true
        }
      },
      supervisor: { select: { user: { select: { username: true } } } },
      _count: { select: { assignments: { where: { sentence: { status: { not: 'submitted' as const } } } } } }
    },
    orderBy: [{ role: 'asc' }, { user: { username: 'asc' } }]
  })
  return rows.map(m => ({
    username: m.user.username,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    supervisorUsername: m.supervisor?.user.username ?? null,
    status: m.status,
    invitationPending: !!m.user.invitedAt && !m.user.invitationAcceptedAt,
    mustResetPassword: m.user.mustResetPassword,
    addedAt: m.createdAt,
    lastSeenAt: m.lastSeenAt,
    lastLogin: m.user.lastLogin,
    openAssignments: m._count.assignments
  }))
}
