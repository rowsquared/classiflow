import 'server-only'
import { db } from '@/lib/workspace/db'

export type CommentSummary = { total: number; unresolved: number }

/** Call inside the record reader's workspace and only with IDs it has authorised. */
export async function commentSummaries(sentenceIds: string[]): Promise<Map<string, CommentSummary>> {
  const summaries = new Map<string, CommentSummary>()
  if (sentenceIds.length === 0) return summaries
  const groups = await db().comment.groupBy({
    by: ['sentenceId', 'resolved'],
    where: { sentenceId: { in: sentenceIds } },
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
