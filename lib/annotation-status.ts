import { Prisma, type SentenceStatus } from '@prisma/client'

/**
 * Record status rules, shared by the single-record and bulk annotation endpoints.
 *
 * - A record is complete when every active taxonomy has human (source 'user')
 *   labels. AI suggestions never count. With no active taxonomy nothing is complete.
 * - Skip and escalate are explicit requests and win.
 * - A save that writes no labels (flag or comment only) never completes a
 *   record and never takes it out of skipped/escalated.
 */
export function decideStatus(opts: {
  requested?: SentenceStatus
  current: SentenceStatus
  wroteLabels: boolean
  complete: boolean
}): SentenceStatus {
  const { requested, current, wroteLabels, complete } = opts
  if (requested === 'skipped' || requested === 'escalated') return requested
  if (!wroteLabels) {
    if (current === 'skipped' || current === 'escalated') return current
    // Labels may have been removed elsewhere (e.g. taxonomy re-import); never upgrade without new labels.
    return current === 'submitted' && !complete ? 'pending' : current
  }
  return complete ? 'submitted' : 'pending'
}

/**
 * Locks the records for the rest of the transaction, in id order so concurrent
 * bulk saves cannot deadlock. Concurrent saves to the same record therefore run
 * one after the other and the last one wins as a whole (no mixed label sets).
 */
export async function lockSentences(tx: Prisma.TransactionClient, sentenceIds: string[]) {
  const ids = Array.from(new Set(sentenceIds)).sort()
  if (ids.length === 0) return
  await tx.$queryRaw`SELECT id FROM "Sentence" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
}

/** For each record, the ids of active taxonomies that have human labels. */
export async function completedTaxonomies(
  tx: Prisma.TransactionClient,
  sentenceIds: string[],
  activeTaxonomyIds: string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>(sentenceIds.map(id => [id, new Set<string>()]))
  if (sentenceIds.length === 0 || activeTaxonomyIds.length === 0) return result
  const rows = await tx.sentenceAnnotation.findMany({
    where: { sentenceId: { in: sentenceIds }, taxonomyId: { in: activeTaxonomyIds }, source: 'user' },
    select: { sentenceId: true, taxonomyId: true },
    distinct: ['sentenceId', 'taxonomyId'],
  })
  rows.forEach(r => result.get(r.sentenceId)?.add(r.taxonomyId))
  return result
}

export function isComplete(done: Set<string> | undefined, activeTaxonomyIds: string[]): boolean {
  return activeTaxonomyIds.length > 0 && activeTaxonomyIds.every(id => done?.has(id))
}
