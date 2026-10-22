import 'server-only'
import { db } from '@/lib/workspace/db'

/**
 * Double annotation per queue row, for supervisors and admins: the latest
 * round that was not stopped, as one compact state plus who labels it.
 * Rows the caller labels themselves (blind) get no summary.
 *
 * - waiting: `done` of 2 parts submitted; `gap` when a part was skipped or
 *   its person no longer exists (someone must take it over);
 * - review: at least one taxonomy disagrees;
 * - agreed / resolved / accepted: confirmed (resolved: after a review;
 *   accepted: the second label was waived).
 */
export type DoubleRowSummary = {
  state: 'waiting' | 'review' | 'agreed' | 'resolved' | 'accepted'
  done: number
  gap: boolean
  people: Array<{ name: string; status: string }>
}

export async function doubleRowSummaries(
  sentenceIds: string[],
  blind: Set<string>
): Promise<Map<string, DoubleRowSummary>> {
  const result = new Map<string, DoubleRowSummary>()
  const ids = sentenceIds.filter(id => !blind.has(id))
  if (ids.length === 0) return result
  const rounds = await db().doubleRound.findMany({
    where: { sentenceId: { in: ids }, status: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
    select: {
      sentenceId: true,
      status: true,
      closeReason: true,
      tasks: {
        where: { status: { not: 'cancelled' } },
        orderBy: { position: 'asc' },
        select: { status: true, assignee: { select: { name: true } } }
      },
      outcomes: { select: { state: true } }
    }
  })
  for (const round of rounds) {
    if (result.has(round.sentenceId)) continue // older round
    const states = round.outcomes.map(o => o.state)
    let state: DoubleRowSummary['state']
    if (round.status === 'active') state = states.includes('disagreed') ? 'review' : 'waiting'
    else if (states.includes('accepted_single')) state = 'accepted'
    else state = states.includes('reviewed') ? 'resolved' : 'agreed'
    result.set(round.sentenceId, {
      state,
      done: round.tasks.filter(t => t.status === 'submitted').length,
      gap: round.status === 'active' && round.tasks.some(t => t.status === 'skipped' || !t.assignee),
      people: round.tasks.map(t => ({ name: t.assignee?.name ?? 'Former member', status: t.status }))
    })
  }
  return result
}
