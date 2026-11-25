import 'server-only'
import type { Prisma } from '@/lib/generated/prisma/client'
import { requestLogger } from '@/lib/logger'
import { db } from '@/lib/workspace/db'

export function labelingRecordLimit(batchSize: number) {
  return Math.min(50_000, 100 * batchSize)
}

export async function lockLabelingTaxonomies(ids: string[]) {
  for (const id of ids.toSorted()) {
    await db().$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('classiflow.labeling.' || ${id}))`
  }
}

export function activeLabelingJob(taxonomyId: string): Prisma.AILabelingJobInputWhereInput {
  return { job: { taxonomyId, status: { in: ['pending', 'processing'] } } }
}

/** The caller holds the taxonomy's labeling lock and schedules admission after commit. */
export async function createLabelingJobs({
  workspaceId,
  actorId,
  taxonomyId,
  connectionVersionId,
  sentenceIds,
  batchSize,
  requestId,
  filterCriteria
}: {
  workspaceId: string
  actorId: string
  taxonomyId: string
  connectionVersionId: string
  sentenceIds: string[]
  batchSize: number
  requestId: string | null
  filterCriteria: Prisma.InputJsonObject
}) {
  const jobs = []
  for (let start = 0; start < sentenceIds.length; start += batchSize) {
    const batch = sentenceIds.slice(start, start + batchSize)
    const job = await db().aILabelingJob.create({
      data: {
        workspaceId,
        createdById: actorId,
        taxonomyId,
        status: 'pending',
        totalSentences: batch.length,
        batchSize,
        connectionVersionId,
        requestId,
        filterCriteria
      },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    })
    for (let offset = 0; offset < batch.length; offset += 1_000) {
      await db().aILabelingJobInput.createMany({
        data: batch.slice(offset, offset + 1_000).map((sentenceId, position) => ({
          workspaceId,
          jobId: job.id,
          sentenceId,
          position: offset + position
        }))
      })
    }
    jobs.push(job)
  }
  ;(await requestLogger()).info(
    { jobs: jobs.length, taxonomy: jobs[0]?.taxonomy.key, records: sentenceIds.length, batchSize },
    'Created AI labeling jobs'
  )
  return jobs
}
