import 'server-only'
import type { CurrentUser, Role } from '@/lib/api-auth'
import { db } from '@/lib/workspace/db'
import { resolveSupervisor } from '@/lib/server/users'
import { lockWorkspaceAdmins } from '@/lib/user-rules'
import { audit } from '@/lib/audit'

/** Attach a global identity without changing its profile, credentials or existing grants. */
export async function addExistingMember(
  actor: CurrentUser,
  input: { existingUser?: string; existingUserId?: string; role: Role; supervisorId?: string | null }
) {
  if (actor.authority !== 'platform')
    return { status: 403, error: 'Only platform admins can add an existing account to a workspace' } as const
  await lockWorkspaceAdmins(actor.workspaceId)
  const identifier = input.existingUser?.trim().toLowerCase()
  if (!input.existingUserId && !identifier) return { status: 400, error: 'Choose a user' } as const
  const account = await db().user.findFirst({
    where: input.existingUserId
      ? { id: input.existingUserId }
      : { OR: [{ username: identifier }, { email: identifier }] },
    select: { id: true, username: true, banned: true }
  })
  if (!account) return { status: 404, error: 'User not found' } as const
  if (account.banned) return { status: 409, error: 'Enable this account before granting workspace access' } as const
  const existing = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: account.id } },
    select: { id: true, status: true }
  })
  if (existing)
    return {
      status: existing.status === 'active' ? 200 : 409,
      ...(existing.status === 'active'
        ? { userId: account.id }
        : { error: 'This membership was removed. Restore access instead.' })
    }
  const supervisorMembershipId = await resolveSupervisor(actor.workspaceId, null, input.supervisorId ?? null)
  if (supervisorMembershipId !== null && typeof supervisorMembershipId === 'object')
    return { status: 400, error: supervisorMembershipId.error } as const
  await db().workspaceMembership.create({
    data: {
      workspaceId: actor.workspaceId,
      userId: account.id,
      role: input.role,
      supervisorMembershipId,
      addedById: actor.id
    }
  })
  await audit({
    actorId: actor.id,
    action: 'member.added',
    entityType: 'user',
    entityId: account.id,
    payload: { username: account.username, role: input.role, existingAccount: true, authority: actor.authority }
  })
  return { status: 201, userId: account.id } as const
}
