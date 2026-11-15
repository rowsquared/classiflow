import 'server-only'
import { db, scopeWorkspaceId } from '@/lib/workspace/db'
import type { LearningRequest } from '@/lib/contracts/taxomind'

type LearningAnnotations = LearningRequest['sentences'][number]['annotations']

export async function lockLearningTaxonomy(taxonomyId: string) {
  await db().$queryRaw`
    SELECT id FROM "Taxonomy" WHERE "workspaceId" = ${scopeWorkspaceId()} AND id = ${taxonomyId} FOR UPDATE`
}

/** Exact label revisions already sent by a successful batch are eligible only after an edit. */
export function selectLearningRecords(taxonomyId: string, legacyCutoff: Date | null) {
  const workspaceId = scopeWorkspaceId()
  return db().$queryRaw<Array<{ sentenceId: string; annotationIds: string[]; annotations: LearningAnnotations }>>`
    WITH candidates AS (
      SELECT a."sentenceId", array_agg(a.id ORDER BY a.level) AS "annotationIds",
             jsonb_agg(jsonb_build_object('level', a.level, 'nodeCode', a."nodeCode") ORDER BY a.level) AS annotations
      FROM "SentenceAnnotation" a
      JOIN "Sentence" s ON s."workspaceId" = a."workspaceId" AND s.id = a."sentenceId"
      WHERE a."workspaceId" = ${workspaceId} AND a."taxonomyId" = ${taxonomyId}
        AND a.source = 'user' AND s.status = 'submitted'
      GROUP BY a."sentenceId"
      HAVING ${legacyCutoff}::timestamp IS NULL
         OR GREATEST(max(a."updatedAt"), max(s."lastEditedAt")) > ${legacyCutoff}::timestamp
    )
    SELECT c.* FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM "AILearningJobInput" i
      JOIN "AILearningJob" j ON j."workspaceId" = i."workspaceId" AND j.id = i."jobId"
      WHERE i."workspaceId" = ${workspaceId} AND i."sentenceId" = c."sentenceId"
        AND i."annotationIds" = c."annotationIds" AND i.annotations = c.annotations
        AND j."taxonomyId" = ${taxonomyId} AND j.status = 'completed'
    )
    ORDER BY c."sentenceId"`
}

/** Credit a completed batch exactly once, in its terminal transition under the taxonomy lock. */
export async function creditLearningBatch(taxonomyId: string, jobId: string) {
  await db().$executeRaw`
    UPDATE "Taxonomy" t
    SET "newAnnotationsSinceLastLearning" = GREATEST(0, t."newAnnotationsSinceLastLearning" - j."queuedAnnotationCount")
    FROM "AILearningJob" j
    WHERE t."workspaceId" = ${scopeWorkspaceId()} AND t.id = ${taxonomyId}
      AND j."workspaceId" = t."workspaceId" AND j."taxonomyId" = t.id
      AND j.id = ${jobId} AND j."queuedAnnotationCount" > 0`
}

/** Call after a learning job reaches a terminal state, with the taxonomy row locked. */
export async function settleLearningRun(taxonomyId: string) {
  const taxonomy = await db().taxonomy.findUnique({
    where: { id: taxonomyId },
    select: { lastLearningJobId: true, lastLearningStatus: true }
  })
  if (!taxonomy?.lastLearningJobId || taxonomy.lastLearningStatus !== 'processing') return
  const first = await db().aILearningJob.findUnique({
    where: { id: taxonomy.lastLearningJobId },
    select: { learningRunId: true, selectionCutoff: true }
  })
  const where = { taxonomyId, learningRunId: first?.learningRunId ?? null }
  const active = await db().aILearningJob.count({ where: { ...where, status: { in: ['pending', 'processing'] } } })
  if (active) return

  // Older batches have no revision snapshots. Leave their watermark as it was so eligible labels can be retried.
  const incomplete = await db().aILearningJob.count({ where: { ...where, status: { not: 'completed' } } })
  if (!first?.selectionCutoff || incomplete) {
    await db().taxonomy.update({
      where: { id: taxonomyId },
      data: {
        lastLearningStatus: 'failed',
        lastLearningError: first?.selectionCutoff
          ? 'One or more learning batches failed or were cancelled. Retry to send the remaining labels.'
          : 'Learning was started before label revisions were tracked. Run learning again to check for unsent labels.'
      }
    })
    return
  }

  await db().taxonomy.update({
    where: { id: taxonomyId },
    data: {
      lastLearningAt: first.selectionCutoff,
      lastLearningStatus: 'completed',
      lastLearningError: null
    }
  })
}
