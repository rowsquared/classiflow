import 'server-only'
import { db } from '@/lib/workspace/db'

export type CommentSummary = { total: number; unresolved: number }

/**
 * Call inside the record reader's workspace and only with IDs it has authorised.
 * `ownOnly`: records the reader sees blind (double annotation), where only
 * their own comments count, as `ownOnly.authorId`'s.
 */
export async function commentSummaries(
  sentenceIds: string[],
  ownOnly?: { authorId: string; sentenceIds: Set<string> }
): Promise<Map<string, CommentSummary>> {
  const summaries = new Map<string, CommentSummary>()
  if (sentenceIds.length === 0) return summaries
  const blind = ownOnly ? sentenceIds.filter(id => ownOnly.sentenceIds.has(id)) : []
  const open = ownOnly ? sentenceIds.filter(id => !ownOnly.sentenceIds.has(id)) : sentenceIds
  const where =
    blind.length === 0
      ? { sentenceId: { in: open } }
      : { OR: [{ sentenceId: { in: open } }, { sentenceId: { in: blind }, authorId: ownOnly!.authorId }] }
  const groups = await db().comment.groupBy({
    by: ['sentenceId', 'resolved'],
    where,
    _count: { _all: true }
  })
  for (const group of groups) {
    const summary = summaries.get(group.sentenceId) ?? { total: 0, unresolved: 0 }
    summary.total += group._count._all
    if (!group.resolved) summary.unresolved += group._count._all
    summaries.set(group.sentenceId, summary)
  }
  return summaries
}
