import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { forbidden, type CurrentUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * Record visibility, shared by every handler that reads or changes records.
 *
 * - admin: every record
 * - supervisor: records assigned to themselves or anyone below them in the
 *   supervisor tree, at any depth
 * - labeller: records assigned to themselves
 *
 * Writes (labels, comments, flags, assignments) require the same visibility as
 * reads. See docs/security.md for the full access matrix.
 */

// Deeper than any real team; stops a corrupt supervisor chain from looping forever.
const MAX_TEAM_DEPTH = 25

/** The user plus everyone below them in the supervisor tree. Cycle-safe. */
export async function getTeamUserIds(rootUserId: string): Promise<string[]> {
  const seen = new Set<string>([rootUserId])
  let frontier = [rootUserId]
  for (let depth = 0; depth < MAX_TEAM_DEPTH && frontier.length > 0; depth++) {
    const reports = await prisma.user.findMany({
      where: { supervisorId: { in: frontier } },
      select: { id: true },
    })
    frontier = reports.map(r => r.id).filter(id => !seen.has(id))
    frontier.forEach(id => seen.add(id))
  }
  return Array.from(seen)
}

/** Users whose assigned records `user` may see; null means unrestricted (admin). */
export async function getVisibleUserIds(user: CurrentUser): Promise<string[] | null> {
  if (user.role === 'admin') return null
  if (user.role === 'supervisor') return getTeamUserIds(user.id)
  return [user.id]
}

/** Prisma filter limiting sentences to those assigned to one of `visibleUserIds`. */
export function sentenceScopeFilter(visibleUserIds: string[] | null): Prisma.SentenceWhereInput {
  if (visibleUserIds === null) return {}
  return { assignments: { some: { userId: { in: visibleUserIds } } } }
}

export async function sentenceVisibilityFilter(user: CurrentUser): Promise<Prisma.SentenceWhereInput> {
  return sentenceScopeFilter(await getVisibleUserIds(user))
}

/**
 * True when every id is an existing record visible to `user`. Admins pass
 * without a lookup; callers handle missing records for them as before.
 */
export async function canAccessSentences(user: CurrentUser, sentenceIds: string[]): Promise<boolean> {
  if (user.role === 'admin') return true
  const ids = Array.from(new Set(sentenceIds))
  if (ids.length === 0) return true
  const visible = await prisma.sentence.count({
    where: { id: { in: ids }, ...(await sentenceVisibilityFilter(user)) },
  })
  return visible === ids.length
}

/** 403 response when any of the records is outside the user's scope, else null. */
export async function denyUnlessSentencesVisible(user: CurrentUser, sentenceIds: string[]) {
  if (await canAccessSentences(user, sentenceIds)) return null
  await audit({
    actorId: user.id, action: 'access.denied', entityType: 'sentence', entityId: sentenceIds[0] ?? '',
    payload: { reason: 'record scope', role: user.role, records: sentenceIds.length },
  })
  return forbidden('You do not have access to one or more of these records')
}
