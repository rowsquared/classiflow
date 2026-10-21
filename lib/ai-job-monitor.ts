/**
 * AI Job Monitor — fire-and-poll architecture.
 *
 * Each job is sent to the external AI API and then polled independently.
 * Multiple jobs can run concurrently (the external API handles its own queue).
 *
 * Supports both labeling jobs (AILabelingJob) and learning jobs (AILearningJob).
 */

import { prisma } from '@/lib/prisma'
import { startAIJob, fetchAIJobStatus } from './ai-labeling'
import type { Prisma } from '@prisma/client'
import { AI_JOB_POLL_INTERVAL_MS, AI_JOB_POLL_TIMEOUT_MS, AI_SOURCE_SLUG, getUnknownCodeForLevel } from './constants'
import { parseLabelingResults } from './ai-results'
import { buildFieldMap } from './ai-utils'

// ---------------------------------------------------------------------------
// Global state for tracking active monitors
// ---------------------------------------------------------------------------

const globalAny = globalThis as typeof globalThis & {
  __activeJobMonitors?: Set<string>
  __lastRecoveryCheck?: number
}

function getActiveMonitors(): Set<string> {
  if (!globalAny.__activeJobMonitors) {
    globalAny.__activeJobMonitors = new Set()
  }
  return globalAny.__activeJobMonitors
}

const RECOVERY_CHECK_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Generic helpers for DB operations on labeling vs learning jobs
// ---------------------------------------------------------------------------

type JobKind = 'labeling' | 'learning'

async function loadJobRecord(jobId: string, kind: JobKind) {
  if (kind === 'learning') {
    return prisma.aILearningJob.findUnique({
      where: { id: jobId },
      include: { taxonomy: { select: { id: true, key: true } } }
    })
  }
  return prisma.aILabelingJob.findUnique({
    where: { id: jobId },
    include: { taxonomy: { select: { id: true, key: true } } }
  })
}

async function updateJobRecord(jobId: string, kind: JobKind, data: Record<string, unknown>) {
  if (kind === 'learning') {
    return prisma.aILearningJob.update({ where: { id: jobId }, data })
  }
  return prisma.aILabelingJob.update({ where: { id: jobId }, data })
}

async function getJobStatus(jobId: string, kind: JobKind) {
  if (kind === 'learning') {
    return prisma.aILearningJob.findUnique({ where: { id: jobId }, select: { status: true } })
  }
  return prisma.aILabelingJob.findUnique({ where: { id: jobId }, select: { status: true } })
}

// ---------------------------------------------------------------------------
// Public API — Labeling jobs
// ---------------------------------------------------------------------------

/**
 * Launch a labeling job: build payload, POST /label, poll for result.
 */
export function launchJob(jobId: string) {
  const monitors = getActiveMonitors()
  if (monitors.has(jobId)) return
  monitors.add(jobId)

  runMonitor(jobId, 'labeling', '/label', async (job) => {
    const criteria = (job.filterCriteria || {}) as { sentenceIds?: string[] }
    const sentenceIds = criteria.sentenceIds || []

    if (sentenceIds.length === 0) throw new Error('No sentences to process')

    const sentences = await prisma.sentence.findMany({
      where: { id: { in: sentenceIds } },
      select: {
        id: true,
        field1: true, field2: true, field3: true, field4: true, field5: true,
        fieldMapping: true
      }
    })

    const sentenceMap = new Map(sentences.map(s => [s.id, s]))
    const payloadSentences = sentenceIds
      .map(id => {
        const sentence = sentenceMap.get(id)
        if (!sentence) return null
        const fields = buildFieldMap(sentence)
        if (Object.keys(fields).length === 0) return null
        return { sentence_id: id, fields }
      })
      .filter(Boolean) as Array<{ sentence_id: string; fields: Record<string, string> }>

    if (payloadSentences.length === 0) throw new Error('No valid sentences to process')

    const externalJobId = await startAIJob('/label', {
      taxonomyKey: job.taxonomy.key,
      ...(AI_SOURCE_SLUG ? { sourceSlug: AI_SOURCE_SLUG } : {}),
      batchId: job.id,
      sentences: payloadSentences
    })

    await updateJobRecord(job.id, 'labeling', {
      externalJobId, status: 'processing', startedAt: new Date(), errorMessage: null
    })

    return externalJobId
  })
}

// ---------------------------------------------------------------------------
// Public API — Learning jobs
// ---------------------------------------------------------------------------

/**
 * Launch a learning job: build payload with annotations, POST /learn, poll.
 */
export function launchLearningJob(jobId: string) {
  const monitors = getActiveMonitors()
  if (monitors.has(jobId)) return
  monitors.add(jobId)

  runMonitor(jobId, 'learning', '/learn', async (job) => {
    const criteria = (job.filterCriteria || {}) as { sentenceIds?: string[] }
    const sentenceIds = criteria.sentenceIds || []

    if (sentenceIds.length === 0) throw new Error('No sentences to process')

    // Load annotations for these sentences (user-submitted only)
    const annotations = await prisma.sentenceAnnotation.findMany({
      where: {
        sentenceId: { in: sentenceIds },
        taxonomyId: job.taxonomyId,
        source: 'user'
      },
      include: {
        sentence: {
          select: {
            id: true,
            field1: true, field2: true, field3: true, field4: true, field5: true,
            fieldMapping: true
          }
        }
      }
    })

    // Group annotations by sentence
    const sentencesMap = new Map<string, {
      sentenceId: string
      fields: Record<string, string>
      annotations: Array<{ level: number; nodeCode: string }>
    }>()

    for (const ann of annotations) {
      if (!sentencesMap.has(ann.sentenceId)) {
        sentencesMap.set(ann.sentenceId, {
          sentenceId: ann.sentenceId,
          fields: buildFieldMap(ann.sentence),
          annotations: []
        })
      }
      sentencesMap.get(ann.sentenceId)!.annotations.push({
        level: ann.level,
        nodeCode: ann.nodeCode
      })
    }

    const sentencesPayload = Array.from(sentencesMap.values())
    if (sentencesPayload.length === 0) throw new Error('No valid annotations to send')

    const externalJobId = await startAIJob('/learn', {
      taxonomyKey: job.taxonomy.key,
      ...(AI_SOURCE_SLUG ? { sourceSlug: AI_SOURCE_SLUG } : {}),
      sentences: sentencesPayload
    })

    await updateJobRecord(job.id, 'learning', {
      externalJobId, status: 'processing', startedAt: new Date(), errorMessage: null
    })

    return externalJobId
  })
}

// ---------------------------------------------------------------------------
// Public API — Recovery
// ---------------------------------------------------------------------------

/**
 * Recovery: check for processing/pending jobs without an active monitor.
 * Safe to call frequently — rate-limited internally.
 */
export async function ensureJobsMonitored() {
  const now = Date.now()
  if (now - (globalAny.__lastRecoveryCheck || 0) < RECOVERY_CHECK_INTERVAL_MS) return
  globalAny.__lastRecoveryCheck = now

  const monitors = getActiveMonitors()

  // Recover labeling jobs
  const orphanedLabeling = await prisma.aILabelingJob.findMany({
    where: { status: { in: ['pending', 'processing'] } },
    select: { id: true, externalJobId: true, status: true }
  })

  for (const job of orphanedLabeling) {
    if (monitors.has(job.id)) continue
    if (job.status === 'pending' && !job.externalJobId) {
      console.log(`[recovery] Launching orphaned labeling job ${job.id}`)
      launchJob(job.id)
    } else if (job.externalJobId) {
      console.log(`[recovery] Resuming polling for labeling job ${job.id}`)
      resumePolling(job.id, job.externalJobId, 'labeling', '/label')
    }
  }

  // Recover learning jobs
  const orphanedLearning = await prisma.aILearningJob.findMany({
    where: { status: { in: ['pending', 'processing'] } },
    select: { id: true, externalJobId: true, status: true }
  })

  for (const job of orphanedLearning) {
    if (monitors.has(job.id)) continue
    if (job.status === 'pending' && !job.externalJobId) {
      console.log(`[recovery] Launching orphaned learning job ${job.id}`)
      launchLearningJob(job.id)
    } else if (job.externalJobId) {
      console.log(`[recovery] Resuming polling for learning job ${job.id}`)
      resumePolling(job.id, job.externalJobId, 'learning', '/learn')
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — generic monitor loop
// ---------------------------------------------------------------------------

function resumePolling(jobId: string, externalJobId: string, kind: JobKind, apiPath: string) {
  const monitors = getActiveMonitors()
  if (monitors.has(jobId)) return
  monitors.add(jobId)

  runMonitor(jobId, kind, apiPath, async () => externalJobId)
}

function runMonitor(
  jobId: string,
  kind: JobKind,
  apiPath: string,
  setup: (job: NonNullable<Awaited<ReturnType<typeof loadJobRecord>>>) => Promise<string>
) {
  ;(async () => {
    try {
      const job = await loadJobRecord(jobId, kind)
      if (!job) return
      if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') return

      const externalJobId = await setup(job)

      await pollUntilComplete(jobId, externalJobId, job.totalSentences, job.taxonomyId, job.filterCriteria, kind, apiPath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[monitor] ${kind} job ${jobId} failed: ${msg}`)
      try {
        await failIfActive(jobId, kind, msg)
      } catch { /* best effort */ }
    } finally {
      getActiveMonitors().delete(jobId)
    }
  })()
}

/**
 * Poll external AI for job status, update progress, store results on completion.
 */
async function pollUntilComplete(
  jobId: string,
  externalJobId: string,
  totalSentences: number,
  taxonomyId: string,
  filterCriteria: unknown,
  kind: JobKind,
  apiPath: string
) {
  const startedAt = Date.now()
  const sentenceIds = ((filterCriteria || {}) as { sentenceIds?: string[] }).sentenceIds || []

  while (true) {
    const current = await getJobStatus(jobId, kind)
    if (!current || current.status === 'cancelled') return

    try {
      const status = await fetchAIJobStatus(`${apiPath}/${externalJobId}/status`)
      const normalized = (status.status || '').toLowerCase()

      const progress = typeof status.progress === 'number' ? status.progress : 0
      await updateJobRecord(jobId, kind, {
        processedSentences: Math.round(progress * totalSentences)
      })

      if (normalized === 'complete' || normalized === 'completed' || normalized === 'success') {
        // Completion is a conditional transition: if the job was cancelled while
        // we waited for the service, nothing is written. Results and status
        // commit together.
        const completed = await prisma.$transaction(async (tx) => {
          const data = { status: 'completed' as const, processedSentences: totalSentences, completedAt: new Date(), errorMessage: null }
          const where = { id: jobId, status: { in: ['pending' as const, 'processing' as const] } }
          const claimed = kind === 'learning'
            ? await tx.aILearningJob.updateMany({ where, data })
            : await tx.aILabelingJob.updateMany({ where, data })
          if (claimed.count === 0) return false
          if (kind === 'labeling') {
            await storeLabelingResults(tx, jobId, taxonomyId, sentenceIds, status.result || status)
          }
          return true
        }, { timeout: 120_000 })
        if (!completed) return

        // For learning jobs, update taxonomy lastLearningAt
        if (kind === 'learning') {
          await updateTaxonomyLearningStatus(taxonomyId)
        }

        return
      }

      if (normalized === 'failed' || normalized === 'error') {
        await failIfActive(jobId, kind, status.error || 'External AI job failed')
        return
      }
    } catch (error) {
      if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
        throw error
      }
    }

    if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
      throw new Error(`Job polling timed out after ${Math.round(AI_JOB_POLL_TIMEOUT_MS / 60000)} minutes`)
    }

    await new Promise(r => setTimeout(r, AI_JOB_POLL_INTERVAL_MS))
  }
}

/**
 * When a learning job completes, update taxonomy's lastLearningAt timestamp.
 * Only updates if there are no other pending/processing learning jobs for this taxonomy.
 */
async function updateTaxonomyLearningStatus(taxonomyId: string) {
  const stillActive = await prisma.aILearningJob.count({
    where: { taxonomyId, status: { in: ['pending', 'processing'] } }
  })
  if (stillActive === 0) {
    await prisma.taxonomy.update({
      where: { id: taxonomyId },
      data: { lastLearningAt: new Date(), lastLearningStatus: 'completed', lastLearningError: null }
    })
  }
}

/** Marks a job failed unless it already reached a final state (e.g. cancelled). */
async function failIfActive(jobId: string, kind: JobKind, message: string) {
  const where = { id: jobId, status: { in: ['pending' as const, 'processing' as const] } }
  const data = { status: 'failed' as const, errorMessage: message, completedAt: new Date() }
  if (kind === 'learning') {
    await prisma.aILearningJob.updateMany({ where, data })
  } else {
    await prisma.aILabelingJob.updateMany({ where, data })
  }
}

/**
 * Validates the completed labeling job's result (lib/ai-results.ts) and stores
 * the suggestions, inside the completion transaction. Only the job's own
 * records are touched, and only codes that exist in the taxonomy (or are the
 * level's unknown code) are kept.
 */
async function storeLabelingResults(
  tx: Prisma.TransactionClient,
  jobId: string,
  taxonomyId: string,
  sentenceIds: string[],
  result: unknown
) {
  const { bySentence, rejected, serviceErrors } = parseLabelingResults(result, sentenceIds)

  const codes = new Set<string>()
  bySentence.forEach(list => list.forEach(s => codes.add(s.nodeCode)))
  const known = new Set(
    (await tx.taxonomyNode.findMany({
      where: { taxonomyId, code: { in: Array.from(codes) } },
      select: { code: true }
    })).map(n => n.code)
  )
  let unknownCodes = 0

  for (const [sentenceId, suggestions] of bySentence) {
    const valid = suggestions.filter(s => known.has(s.nodeCode) || s.nodeCode === getUnknownCodeForLevel(s.level))
    unknownCodes += suggestions.length - valid.length
    await tx.sentenceAISuggestion.deleteMany({ where: { sentenceId, taxonomyId } })
    if (valid.length === 0) continue
    await tx.sentenceAISuggestion.createMany({
      data: valid.map(s => ({
        sentenceId,
        taxonomyId,
        level: s.level,
        nodeCode: s.nodeCode,
        confidenceScore: s.confidence
      }))
    })
  }

  if (rejected > 0 || unknownCodes > 0) {
    console.warn(`[monitor] labeling job ${jobId}: dropped ${rejected} malformed/foreign record result(s) and ${unknownCodes} suggestion(s) with codes not in the taxonomy`)
  }
  if (serviceErrors + rejected > 0) {
    await tx.aILabelingJob.update({ where: { id: jobId }, data: { failedSentences: serviceErrors + rejected } })
  }
}
