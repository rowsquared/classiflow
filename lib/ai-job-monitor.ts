/**
 * AI Job Monitor — fire-and-poll architecture.
 *
 * Each job is sent to the external AI API and then polled independently.
 * Multiple jobs can run concurrently (the external API handles its own queue).
 *
 * Supports both labeling jobs (AILabelingJob) and learning jobs (AILearningJob).
 *
 * Ownership: a job is monitored by the app instance holding its lease
 * (`leaseOwner`, `leaseExpiresAt`). The lease is claimed with a conditional
 * update before the job is started or polled and renewed on every poll, so two
 * instances never both send or poll the same job. When an instance dies or
 * restarts, its leases expire and recovery (startJobRecovery, run from
 * instrumentation.ts) lets any instance take the job over: it resumes polling
 * if the external job was already started, otherwise it starts it.
 *
 * Workspaces: every job belongs to one workspace, and all its reads and writes
 * run in that workspace's transactions (lib/workspace/db.ts), reconstructed
 * from the job row, never from a browser's selection. Recovery finds jobs in
 * all workspaces through the database function app_recoverable_ai_jobs(),
 * which returns only ids. Results are written only while the workspace is
 * active, and only for the job's own records.
 */

import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { db, withWorkspace } from '@/lib/workspace/db'
import { startAIJob, fetchAIJobStatus } from './ai-labeling'
import type { Prisma } from '@/lib/generated/prisma/client'
import { AI_JOB_POLL_INTERVAL_MS, AI_JOB_POLL_TIMEOUT_MS, aiSourceSlug, getUnknownCodeForLevel } from './constants'
import { parseLabelingResults } from './ai-results'
import { buildFieldMap } from './ai-utils'

// ---------------------------------------------------------------------------
// Global state for tracking active monitors
// ---------------------------------------------------------------------------

const globalAny = globalThis as typeof globalThis & {
  __activeJobMonitors?: Set<string>
  __lastRecoveryCheck?: number
  __jobRecoveryTimer?: ReturnType<typeof setInterval>
  __aiMonitorInstanceId?: string
}

function getActiveMonitors(): Set<string> {
  if (!globalAny.__activeJobMonitors) {
    globalAny.__activeJobMonitors = new Set()
  }
  return globalAny.__activeJobMonitors
}

/** Identifies this process as a lease owner. */
export function monitorInstanceId(): string {
  if (!globalAny.__aiMonitorInstanceId) {
    globalAny.__aiMonitorInstanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
  }
  return globalAny.__aiMonitorInstanceId
}

const RECOVERY_CHECK_INTERVAL_MS = 30_000
// Long enough to cover one poll interval plus a slow status request (30 s), so
// a live monitor always renews in time; short enough that a dead instance's
// jobs are taken over within minutes.
const LEASE_MS = 2 * AI_JOB_POLL_INTERVAL_MS + 60_000
// Status requests that fail are retried with exponential backoff up to this.
const MAX_POLL_BACKOFF_MS = 5 * 60_000

// ---------------------------------------------------------------------------
// Generic helpers for DB operations on labeling vs learning jobs
// ---------------------------------------------------------------------------

type JobKind = 'labeling' | 'learning'

async function loadJobRecord(workspaceId: string, jobId: string, kind: JobKind) {
  return withWorkspace(workspaceId, () => {
    const args = { where: { id: jobId }, include: { taxonomy: { select: { id: true, key: true } } } }
    return kind === 'learning' ? db().aILearningJob.findUnique(args) : db().aILabelingJob.findUnique(args)
  })
}

async function updateJobRecord(workspaceId: string, jobId: string, kind: JobKind, data: Record<string, unknown>) {
  await withWorkspace(workspaceId, async () => {
    if (kind === 'learning') {
      await db().aILearningJob.update({ where: { id: jobId }, data })
    } else {
      await db().aILabelingJob.update({ where: { id: jobId }, data })
    }
  })
}

async function getJobStatus(workspaceId: string, jobId: string, kind: JobKind) {
  return withWorkspace(workspaceId, () => {
    const args = { where: { id: jobId }, select: { status: true } }
    return kind === 'learning' ? db().aILearningJob.findUnique(args) : db().aILabelingJob.findUnique(args)
  })
}

const ACTIVE = ['pending' as const, 'processing' as const]

/**
 * Takes (or renews) this instance's lease on an active job. Succeeds when the
 * job is unowned, its lease expired, or this instance already holds it.
 */
async function claimLease(workspaceId: string, jobId: string, kind: JobKind): Promise<boolean> {
  const now = new Date()
  const owner = monitorInstanceId()
  const where = {
    id: jobId,
    status: { in: ACTIVE },
    OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: owner }],
  }
  const data = { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) }
  const result = await withWorkspace(workspaceId, () => kind === 'learning'
    ? db().aILearningJob.updateMany({ where, data })
    : db().aILabelingJob.updateMany({ where, data }))
  return result.count === 1
}

/** Gives the lease back so another instance can take over at once. */
async function releaseLease(workspaceId: string, jobId: string, kind: JobKind) {
  const where = { id: jobId, leaseOwner: monitorInstanceId() }
  const data = { leaseOwner: null, leaseExpiresAt: null }
  await withWorkspace(workspaceId, async () => {
    if (kind === 'learning') {
      await db().aILearningJob.updateMany({ where, data })
    } else {
      await db().aILabelingJob.updateMany({ where, data })
    }
  })
}

type JobRecord = NonNullable<Awaited<ReturnType<typeof loadJobRecord>>>

const API_PATH: Record<JobKind, string> = { labeling: '/label', learning: '/learn' }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Labeling job: build payload, POST /label, poll for result. */
export function launchJob(jobId: string, workspaceId: string) {
  runMonitor(jobId, 'labeling', workspaceId)
}

/** Learning job: build payload with annotations, POST /learn, poll. */
export function launchLearningJob(jobId: string, workspaceId: string) {
  runMonitor(jobId, 'learning', workspaceId)
}

/**
 * Recovery: monitors every pending/processing job that no live instance holds.
 * Safe to call frequently — rate-limited internally; jobs another instance
 * holds a valid lease on are left alone by claimLease().
 */
export async function ensureJobsMonitored() {
  const now = Date.now()
  if (now - (globalAny.__lastRecoveryCheck || 0) < RECOVERY_CHECK_INTERVAL_MS) return
  globalAny.__lastRecoveryCheck = now

  const monitors = getActiveMonitors()
  // Ids and workspaces only (SECURITY DEFINER function, see the migration);
  // each job is then read and claimed inside its own workspace.
  const jobs = await prisma.$queryRaw<Array<{ kind: JobKind; id: string; workspaceId: string }>>`
    SELECT kind, id, "workspaceId" FROM app_recoverable_ai_jobs(${new Date()}::timestamp)`
  for (const job of jobs) {
    if (monitors.has(job.id)) continue
    console.log(`[recovery] Taking over ${job.kind} job ${job.id}`)
    runMonitor(job.id, job.kind, job.workspaceId)
  }
}

/**
 * Runs recovery now and every RECOVERY_CHECK_INTERVAL_MS in this process, so
 * jobs left by a restart or a dead instance continue without anyone having the
 * AI jobs page open. Called once from instrumentation.ts; no-op without AI.
 */
export function startJobRecovery() {
  if (globalAny.__jobRecoveryTimer) return
  if (!process.env.AI_LABELING_API_URL || !process.env.AI_LABELING_API_KEY) return
  const tick = () => {
    ensureJobsMonitored().catch(error => console.error('[recovery] failed:', error))
  }
  globalAny.__jobRecoveryTimer = setInterval(tick, RECOVERY_CHECK_INTERVAL_MS)
  globalAny.__jobRecoveryTimer.unref?.()
  tick()
}

// ---------------------------------------------------------------------------
// Internal — starting external jobs
// ---------------------------------------------------------------------------

async function startLabeling(job: JobRecord): Promise<string> {
  const criteria = (job.filterCriteria || {}) as { sentenceIds?: string[] }
  const sentenceIds = criteria.sentenceIds || []

  if (sentenceIds.length === 0) throw new Error('No sentences to process')

  const sentences = await withWorkspace(job.workspaceId, () => db().sentence.findMany({
    where: { workspaceId: job.workspaceId, id: { in: sentenceIds } },
    select: {
      id: true,
      field1: true, field2: true, field3: true, field4: true, field5: true,
      fieldMapping: true
    }
  }))

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
    sourceSlug: aiSourceSlug(job.workspaceId),
    batchId: job.id,
    sentences: payloadSentences
  })

  await updateJobRecord(job.workspaceId, job.id, 'labeling', {
    externalJobId, status: 'processing', startedAt: new Date(), errorMessage: null
  })

  return externalJobId
}

async function startLearning(job: JobRecord): Promise<string> {
  const criteria = (job.filterCriteria || {}) as { sentenceIds?: string[] }
  const sentenceIds = criteria.sentenceIds || []

  if (sentenceIds.length === 0) throw new Error('No sentences to process')

  // Load annotations for these sentences (user-submitted only)
  const annotations = await withWorkspace(job.workspaceId, () => db().sentenceAnnotation.findMany({
    where: {
      workspaceId: job.workspaceId,
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
  }))

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
    sourceSlug: aiSourceSlug(job.workspaceId),
    sentences: sentencesPayload
  })

  await updateJobRecord(job.workspaceId, job.id, 'learning', {
    externalJobId, status: 'processing', startedAt: new Date(), errorMessage: null
  })

  return externalJobId
}

// ---------------------------------------------------------------------------
// Internal — generic monitor loop
// ---------------------------------------------------------------------------

function runMonitor(jobId: string, kind: JobKind, workspaceId: string) {
  const monitors = getActiveMonitors()
  if (monitors.has(jobId)) return
  monitors.add(jobId)

  ;(async () => {
    let leased = false
    try {
      leased = await claimLease(workspaceId, jobId, kind)
      if (!leased) return // finished, or another instance owns it

      // Loaded after claiming, so a job another instance already started is
      // resumed (externalJobId set) rather than sent twice.
      const job = await loadJobRecord(workspaceId, jobId, kind)
      if (!job) return
      if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') return

      const externalJobId = job.externalJobId
        ?? (kind === 'learning' ? await startLearning(job) : await startLabeling(job))

      await pollUntilComplete(workspaceId, jobId, externalJobId, job.totalSentences, job.taxonomyId, job.filterCriteria, kind)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[monitor] ${kind} job ${jobId} failed: ${msg}`)
      try {
        await failIfActive(workspaceId, jobId, kind, msg)
      } catch { /* best effort */ }
    } finally {
      monitors.delete(jobId)
      if (leased) {
        await releaseLease(workspaceId, jobId, kind).catch(() => { /* expires on its own */ })
      }
    }
  })()
}

/**
 * Poll external AI for job status, update progress, store results on completion.
 */
async function pollUntilComplete(
  workspaceId: string,
  jobId: string,
  externalJobId: string,
  totalSentences: number,
  taxonomyId: string,
  filterCriteria: unknown,
  kind: JobKind
) {
  const startedAt = Date.now()
  const sentenceIds = ((filterCriteria || {}) as { sentenceIds?: string[] }).sentenceIds || []
  let consecutiveErrors = 0

  while (true) {
    const current = await getJobStatus(workspaceId, jobId, kind)
    if (!current || current.status === 'cancelled') return
    if (!(await claimLease(workspaceId, jobId, kind))) {
      console.warn(`[monitor] ${kind} job ${jobId}: lease lost to another instance; stopping here`)
      return
    }

    try {
      const status = await fetchAIJobStatus(`${API_PATH[kind]}/${externalJobId}/status`)
      consecutiveErrors = 0
      const normalized = (status.status || '').toLowerCase()

      const progress = typeof status.progress === 'number' ? status.progress : 0
      await updateJobRecord(workspaceId, jobId, kind, {
        processedSentences: Math.round(progress * totalSentences)
      })

      if (normalized === 'complete' || normalized === 'completed' || normalized === 'success') {
        // Completion is a conditional transition: if the job was cancelled while
        // we waited for the service, nothing is written. Results and status
        // commit together, and only while the workspace is active (write: an
        // archived workspace refuses them).
        const completed = await withWorkspace(workspaceId, async () => {
          const tx = db()
          const data = { status: 'completed' as const, processedSentences: totalSentences, completedAt: new Date(), errorMessage: null, leaseOwner: null, leaseExpiresAt: null }
          const where = { id: jobId, status: { in: ['pending' as const, 'processing' as const] } }
          const claimed = kind === 'learning'
            ? await tx.aILearningJob.updateMany({ where, data })
            : await tx.aILabelingJob.updateMany({ where, data })
          if (claimed.count === 0) return false
          if (kind === 'labeling') {
            await storeLabelingResults(tx, workspaceId, jobId, taxonomyId, sentenceIds, status.result || status)
          }
          return true
        }, { write: true, timeoutMs: 120_000 })
        if (!completed) return

        // For learning jobs, update taxonomy lastLearningAt
        if (kind === 'learning') {
          await updateTaxonomyLearningStatus(workspaceId, taxonomyId)
        }

        return
      }

      if (normalized === 'failed' || normalized === 'error') {
        await failIfActive(workspaceId, jobId, kind, status.error || 'External AI job failed')
        return
      }
    } catch (error) {
      if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
        throw error
      }
      consecutiveErrors++
      console.warn(`[monitor] ${kind} job ${jobId}: status request failed (${consecutiveErrors} in a row): ${error instanceof Error ? error.message : error}`)
    }

    if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
      throw new Error(`Job polling timed out after ${Math.round(AI_JOB_POLL_TIMEOUT_MS / 60000)} minutes`)
    }

    await new Promise(r => setTimeout(r, pollDelay(consecutiveErrors)))
  }
}

/** Poll interval, doubled per consecutive failed status request (capped). */
export function pollDelay(consecutiveErrors: number): number {
  return Math.min(AI_JOB_POLL_INTERVAL_MS * 2 ** consecutiveErrors, Math.max(MAX_POLL_BACKOFF_MS, AI_JOB_POLL_INTERVAL_MS))
}

/**
 * When a learning job completes, update taxonomy's lastLearningAt timestamp.
 * Only updates if there are no other pending/processing learning jobs for this taxonomy.
 */
async function updateTaxonomyLearningStatus(workspaceId: string, taxonomyId: string) {
  await withWorkspace(workspaceId, async () => {
    const stillActive = await db().aILearningJob.count({
      where: { taxonomyId, status: { in: ['pending', 'processing'] } }
    })
    if (stillActive === 0) {
      await db().taxonomy.update({
        where: { id: taxonomyId },
        data: { lastLearningAt: new Date(), lastLearningStatus: 'completed', lastLearningError: null }
      })
    }
  })
}

/** Marks a job failed unless it already reached a final state (e.g. cancelled). */
async function failIfActive(workspaceId: string, jobId: string, kind: JobKind, message: string) {
  const where = { id: jobId, status: { in: ['pending' as const, 'processing' as const] } }
  const data = { status: 'failed' as const, errorMessage: message, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
  await withWorkspace(workspaceId, async () => {
    if (kind === 'learning') {
      await db().aILearningJob.updateMany({ where, data })
    } else {
      await db().aILabelingJob.updateMany({ where, data })
    }
  })
}

/**
 * Validates the completed labeling job's result (lib/ai-results.ts) and stores
 * the suggestions, inside the completion transaction. Only the job's own
 * records are touched, and only codes that exist in the taxonomy (or are the
 * level's unknown code) are kept.
 */
async function storeLabelingResults(
  tx: Prisma.TransactionClient,
  workspaceId: string,
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
        workspaceId,
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
