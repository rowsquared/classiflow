import type { Prisma } from '@/lib/generated/prisma/client'
import { forbidden, type CurrentUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { db } from '@/lib/workspace/db'

/**
 * Record visibility inside one workspace, shared by every handler that reads
 * or changes records. Always run inside the workspace's transaction (db()).
 *
 * - admin: every record of the workspace
 * - supervisor: records assigned to their own membership or anyone below it in
 *   this workspace's supervisor tree, at any depth
 * - labeller: records assigned to their membership
 *
 * Writes (labels, comments, flags, assignments) require the same visibility as
 * reads. See docs/security.md for the full access matrix.
 */

// Deeper than any real team; stops a corrupt supervisor chain from looping forever.
const MAX_TEAM_DEPTH = 25

/** The membership plus every active membership below it in the tree. Cycle-safe. */
export async function getTeamMembershipIds(workspaceId: string, rootMembershipId: string): Promise<string[]> {
  const seen = new Set<string>([rootMembershipId])
  let frontier = [rootMembershipId]
  for (let depth = 0; depth < MAX_TEAM_DEPTH && frontier.length > 0; depth++) {
    const reports = await db().workspaceMembership.findMany({
      where: { workspaceId, supervisorMembershipId: { in: frontier } },
      select: { id: true }
    })
    frontier = reports.map(r => r.id).filter(id => !seen.has(id))
    frontier.forEach(id => seen.add(id))
  }
  return Array.from(seen)
}

/** Memberships whose assigned records `user` may see; null means all (admin). */
export async function getVisibleMembershipIds(user: CurrentUser): Promise<string[] | null> {
  if (user.role === 'admin') return null
  if (!user.membershipId) return []
  if (user.role === 'supervisor') return getTeamMembershipIds(user.workspaceId, user.membershipId)
  return [user.membershipId]
}

/** User ids behind getVisibleMembershipIds(), for authorship filters; null means all. */
export async function getVisibleUserIds(user: CurrentUser): Promise<string[] | null> {
  const membershipIds = await getVisibleMembershipIds(user)
  if (membershipIds === null) return null
  if (membershipIds.length === 0) return []
  const rows = await db().workspaceMembership.findMany({
    where: { workspaceId: user.workspaceId, id: { in: membershipIds } },
    select: { userId: true }
  })
  return rows.map(r => r.userId)
}

/** Prisma filter: this workspace's records, limited to those assigned to `membershipIds` (null: all). */
export function sentenceScopeFilter(user: CurrentUser, membershipIds: string[] | null): Prisma.SentenceWhereInput {
  if (membershipIds === null) return { workspaceId: user.workspaceId }
  return { workspaceId: user.workspaceId, assignments: { some: { membershipId: { in: membershipIds } } } }
}

export async function sentenceVisibilityFilter(user: CurrentUser): Promise<Prisma.SentenceWhereInput> {
  return sentenceScopeFilter(user, await getVisibleMembershipIds(user))
}

/** True when every id is an existing record of this workspace visible to `user`. */
export async function canAccessSentences(user: CurrentUser, sentenceIds: string[]): Promise<boolean> {
  const ids = Array.from(new Set(sentenceIds))
  if (ids.length === 0) return true
  const visible = await db().sentence.count({
    where: { id: { in: ids }, ...(await sentenceVisibilityFilter(user)) }
  })
  return visible === ids.length
}

/** 403 response when any of the records is outside the user's scope, else null. */
export async function denyUnlessSentencesVisible(user: CurrentUser, sentenceIds: string[]) {
  if (await canAccessSentences(user, sentenceIds)) return null
  await audit({
    actorId: user.id,
    action: 'access.denied',
    entityType: 'sentence',
    entityId: sentenceIds[0] ?? '',
    payload: { reason: 'record scope', role: user.role, records: sentenceIds.length }
  })
  return forbidden('You do not have access to one or more of these records')
}
