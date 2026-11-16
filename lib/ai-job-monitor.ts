/**
 * AI Job Monitor — queue, admit, fire and poll.
 *
 * Three kinds of job talk to the AI service: labeling (AILabelingJob),
 * learning (AILearningJob) and taxonomy sync (AITaxonomySyncJob). Routes create
 * them as `pending` (queued) and call scheduleAIJobs() after commit.
 *
 * Admission: app_admit_ai_jobs() (a database function under an advisory lock)
 * moves queued jobs to `processing` while fewer than
 * AI_MAX_ACTIVE_JOBS_PER_WORKSPACE jobs of their workspace and
 * AI_MAX_ACTIVE_JOBS jobs overall are processing, fairly across workspaces,
 * and leases them to this instance. Every finished job admits the next ones.
 *
 * Ownership: a job is monitored by the app instance holding its lease
 * (`leaseOwner`, `leaseExpiresAt`). The lease is claimed with a conditional
 * update before the job is started or polled and renewed on every poll, so two
 * instances never both send or poll the same job. When an instance stops it
 * gives its leases back (releaseAllLeases on SIGTERM/SIGINT); when it dies
 * they expire. Recovery (startJobRecovery, run from instrumentation.ts) lets
 * any instance take an orphaned job over: it resumes polling if the external
 * job was already started, otherwise it starts it.
 *
 * Workspaces: every job belongs to one workspace and one immutable AI
 * connection version (lib/ai-connections.ts), and all its reads and writes run
 * in that workspace's transactions (lib/workspace/db.ts), reconstructed from
 * the job row, never from a browser's selection. Only the cross-workspace
 * database functions (recovery, admission, lease release) see other
 * workspaces' jobs, and they return ids only. Results are written only while
 * the workspace is active, and only for the job's own input records
 * (AILabelingJobInput).
 */

import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { db, withWorkspace } from '@/lib/workspace/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import {
  AI_JOB_POLL_INTERVAL_MS,
  AI_JOB_POLL_TIMEOUT_MS,
  AI_MAX_ACTIVE_JOBS,
  AI_MAX_ACTIVE_JOBS_PER_ENDPOINT,
  AI_MAX_ACTIVE_JOBS_PER_WORKSPACE,
  getUnknownCodeForLevel
} from './constants'
import { parseLabelingResults, type LearningRequest, type TaxomindResource } from './contracts/taxomind'
import { AI_REQUEST_TIMEOUT_POST_MS, TaxomindRequestError, type TaxomindClient } from './ai-labeling'
import { creditLearningBatch, lockLearningTaxonomy, settleLearningRun } from '@/lib/server/ai-learning'
import { connectionClient, ensureEnvEndpoint } from './ai-connections'
import { deploymentKeyring } from './ai-credentials'
import { buildFieldMap } from './ai-utils'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Process state
// ---------------------------------------------------------------------------

const globalAny = globalThis as typeof globalThis & {
  __activeJobMonitors?: Set<string>
  __lastRecoveryCheck?: number
  __jobRecoveryTimer?: ReturnType<typeof setInterval>
  __aiMonitorInstanceId?: string
  __aiAdmission?: { running: boolean; again: boolean }
  __aiShuttingDown?: boolean
  __aiShutdownHandler?: boolean
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

const shuttingDown = () => globalAny.__aiShuttingDown === true

const RECOVERY_CHECK_INTERVAL_MS = 30_000
// Long enough to cover one poll interval plus a slow status request (30 s), so
// a live monitor always renews in time; short enough that a dead instance's
// jobs are taken over within minutes.
const LEASE_MS = 2 * AI_JOB_POLL_INTERVAL_MS + 60_000
// Status requests that fail are retried with exponential backoff up to this.
const MAX_POLL_BACKOFF_MS = 5 * 60_000
const START_ATTEMPTS = 6
const ENDPOINT_START_BACKOFF_MS = 60_000
const START_LEASE_MS = Math.max(LEASE_MS, AI_REQUEST_TIMEOUT_POST_MS + 60_000)
const POLL_LEASE_MS = Math.max(LEASE_MS, 210_000) // Status request, result transaction and pool wait.
const RESULT_IMPORT_ATTEMPTS = 3
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// Prisma stores timestamps as UTC wall time; the database functions take that.
const utcWallTime = (date: Date) => date.toISOString()

// ---------------------------------------------------------------------------
// The three job tables behind one small interface
// ---------------------------------------------------------------------------

export type JobKind = 'labeling' | 'learning' | 'sync'

const API_RESOURCE: Record<JobKind, TaxomindResource> = { labeling: 'label', learning: 'learn', sync: 'taxonomies' }

type JobTable = {
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  count(args: { where: Record<string, unknown> }): Promise<number>
}

function jobTable(kind: JobKind): JobTable {
  const tx = db()
  const table = kind === 'learning' ? tx.aILearningJob : kind === 'sync' ? tx.aITaxonomySyncJob : tx.aILabelingJob
  return table as unknown as JobTable
}

type JobRecord = {
  id: string
  workspaceId: string
  taxonomyId: string
  status: string
  startedAt: Date
  externalJobId: string | null
  connectionVersionId: string
  requestId: string | null
  totalSentences: number | null
  taxonomy: { id: string; key: string }
}

async function loadJobRecord(workspaceId: string, jobId: string, kind: JobKind): Promise<JobRecord | null> {
  return withWorkspace(workspaceId, async () => {
    const select = {
      id: true,
      workspaceId: true,
      taxonomyId: true,
      status: true,
      startedAt: true,
      externalJobId: true,
      connectionVersionId: true,
      requestId: true,
      taxonomy: { select: { id: true, key: true } }
    } as const
    if (kind === 'sync') {
      const job = await db().aITaxonomySyncJob.findUnique({ where: { id: jobId }, select })
      return job && { ...job, totalSentences: null }
    }
    const args = { where: { id: jobId }, select: { ...select, totalSentences: true } }
    return kind === 'learning' ? db().aILearningJob.findUnique(args) : db().aILabelingJob.findUnique(args)
  })
}

async function updateJobRecord(workspaceId: string, jobId: string, kind: JobKind, data: Record<string, unknown>) {
  await withWorkspace(workspaceId, () => jobTable(kind).updateMany({ where: { id: jobId }, data }))
}

async function isStillProcessing(workspaceId: string, jobId: string, kind: JobKind): Promise<boolean> {
  const count = await withWorkspace(workspaceId, () =>
    jobTable(kind).count({ where: { id: jobId, status: 'processing' } })
  )
  return count === 1
}

/**
 * Takes (or renews) this instance's lease on an admitted job. Succeeds when
 * the job is unowned, its lease expired, or this instance already holds it.
 * Fails while the instance shuts down, so its monitors stop.
 */
async function claimLease(workspaceId: string, jobId: string, kind: JobKind, duration = LEASE_MS): Promise<boolean> {
  if (shuttingDown()) return false
  const now = new Date()
  const owner = monitorInstanceId()
  const where = {
    id: jobId,
    status: 'processing',
    OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: owner }]
  }
  const data = { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + duration) }
  const result = await withWorkspace(workspaceId, () => jobTable(kind).updateMany({ where, data }))
  return result.count === 1
}

/** Gives the lease back so another instance can take over at once. */
async function releaseLease(workspaceId: string, jobId: string, kind: JobKind) {
  const where = { id: jobId, leaseOwner: monitorInstanceId() }
  const data = { leaseOwner: null, leaseExpiresAt: null }
  await withWorkspace(workspaceId, () => jobTable(kind).updateMany({ where, data }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Admits queued jobs (of every workspace) up to the ceilings and starts
 * monitoring them. Call after committing new jobs; safe to call often.
 */
export function scheduleAIJobs(): void {
  admitQueuedJobs().catch(error => logger.error({ err: error }, 'AI job admission failed'))
}

export async function admitQueuedJobs(): Promise<void> {
  if (shuttingDown()) return
  const state = (globalAny.__aiAdmission ??= { running: false, again: false })
  if (state.running) {
    state.again = true
    return
  }
  state.running = true
  try {
    do {
      state.again = false
      const leaseUntil = new Date(Date.now() + LEASE_MS)
      const admitted = await prisma.$queryRaw<Array<{ kind: JobKind; id: string; workspaceId: string }>>`
        SELECT kind, id, "workspaceId" FROM app_admit_ai_jobs(
          ${AI_MAX_ACTIVE_JOBS_PER_WORKSPACE}::integer, ${AI_MAX_ACTIVE_JOBS}::integer,
          ${AI_MAX_ACTIVE_JOBS_PER_ENDPOINT}::integer,
          ${monitorInstanceId()}, ${utcWallTime(leaseUntil)}::timestamp)`
      for (const job of admitted) runMonitor(job.id, job.kind, job.workspaceId)
    } while (state.again && !shuttingDown())
  } finally {
    state.running = false
  }
}

/**
 * Recovery: monitors every admitted job that no live instance holds, then
 * admits queued jobs. Safe to call frequently — rate-limited internally; jobs
 * another instance holds a valid lease on are left alone by claimLease().
 */
export async function ensureJobsMonitored() {
  const now = Date.now()
  if (now - (globalAny.__lastRecoveryCheck || 0) < RECOVERY_CHECK_INTERVAL_MS) return
  globalAny.__lastRecoveryCheck = now
  if (shuttingDown()) return

  const monitors = getActiveMonitors()
  // Ids and workspaces only (SECURITY DEFINER function, see the migrations);
  // each job is then read and claimed inside its own workspace.
  const jobs = await prisma.$queryRaw<Array<{ kind: JobKind; id: string; workspaceId: string }>>`
    SELECT kind, id, "workspaceId" FROM app_recoverable_ai_jobs(${utcWallTime(new Date())}::timestamp)`
  for (const job of jobs) {
    if (monitors.has(job.id)) continue
    logger.info({ kind: job.kind, jobId: job.id }, 'Taking over AI job')
    runMonitor(job.id, job.kind, job.workspaceId)
  }
  await admitQueuedJobs()
}

/**
 * Runs recovery now and every RECOVERY_CHECK_INTERVAL_MS in this process, so
 * jobs left by a restart or a dead instance continue without anyone having the
 * AI jobs page open, and gives this instance's leases back when it is told to
 * stop. Called once from instrumentation.ts; no-op unless the deployment can
 * run AI (AI_CREDENTIALS_KEYS).
 */
export function startJobRecovery(stopTelemetry?: () => Promise<void>) {
  if (globalAny.__jobRecoveryTimer) return
  let keysConfigured = false
  try {
    keysConfigured = deploymentKeyring() !== null
  } catch (error) {
    logger.error({ err: error }, 'AI credential keys are not usable; AI jobs will not run')
  }
  if (keysConfigured || stopTelemetry) installShutdownHandler(keysConfigured, stopTelemetry)
  if (!keysConfigured) return
  ensureEnvEndpoint().catch(error => logger.error({ err: error }, 'Could not register AI_LABELING_API_URL'))
  const tick = () => {
    ensureJobsMonitored().catch(error => logger.error({ err: error }, 'AI job recovery failed'))
  }
  globalAny.__jobRecoveryTimer = setInterval(tick, RECOVERY_CHECK_INTERVAL_MS)
  globalAny.__jobRecoveryTimer.unref?.()
  tick()
}

/**
 * Stops this instance's monitors and gives back every lease it holds, so
 * another instance takes the jobs over at once instead of after the lease
 * expires. Returns the number of released leases.
 */
export async function releaseAllLeases(): Promise<number> {
  globalAny.__aiShuttingDown = true
  if (globalAny.__jobRecoveryTimer) clearInterval(globalAny.__jobRecoveryTimer)
  const [row] = await prisma.$queryRaw<Array<{ released: number }>>`
    SELECT app_release_ai_leases(${monitorInstanceId()}) AS released`
  return row?.released ?? 0
}

/** For tests: lets this process monitor jobs again after releaseAllLeases(). */
export function resumeAfterRelease() {
  globalAny.__aiShuttingDown = false
  globalAny.__jobRecoveryTimer = undefined
}

function installShutdownHandler(aiConfigured: boolean, stopTelemetry?: () => Promise<void>) {
  if (globalAny.__aiShutdownHandler) return
  globalAny.__aiShutdownHandler = true
  let stopping = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    const release = aiConfigured
      ? releaseAllLeases()
          .then(released => {
            if (released > 0) logger.info({ signal, released }, 'Released AI job leases')
          })
          .catch(error => logger.error({ err: error }, 'Could not release AI job leases'))
      : undefined
    const flush = stopTelemetry?.().catch(error => logger.error({ err: error }, 'Could not flush telemetry'))
    void Promise.all([release, flush]).then(() => {
      // Next.js closes the server unless told to leave signals to the application.
      if (process.env.NEXT_MANUAL_SIG_HANDLE) process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
}

/**
 * Cancels a job on the AI service, best effort, with the job's own
 * connection. `requestId` is the cancelling request's.
 */
export async function cancelExternalJob(
  workspaceId: string,
  kind: JobKind,
  externalJobId: string,
  connectionVersionId: string,
  requestId?: string | null
): Promise<void> {
  try {
    const { client } = await connectionClient(workspaceId, connectionVersionId, requestId)
    await client.cancelJob(API_RESOURCE[kind], externalJobId)
  } catch (error) {
    logger.warn({ kind, externalJobId, err: error }, 'Could not cancel external AI job')
  }
}

// ---------------------------------------------------------------------------
// Internal — starting external jobs
// ---------------------------------------------------------------------------

const sentenceFields = {
  id: true,
  field1: true,
  field2: true,
  field3: true,
  field4: true,
  field5: true,
  fieldMapping: true
} as const

async function startLabeling(job: JobRecord, client: TaxomindClient, namespace: string): Promise<string> {
  const inputs = await withWorkspace(job.workspaceId, () =>
    db().aILabelingJobInput.findMany({
      where: { jobId: job.id },
      orderBy: { position: 'asc' },
      select: { sentence: { select: sentenceFields } }
    })
  )
  if (inputs.length === 0) throw new Error('No sentences to process')

  const payloadSentences = inputs
    .map(({ sentence }) => ({ sentence_id: sentence.id, fields: buildFieldMap(sentence) }))
    .filter(s => Object.keys(s.fields).length > 0)
  if (payloadSentences.length === 0) throw new Error('No valid sentences to process')

  return client.startLabelingJob({
    taxonomyKey: job.taxonomy.key,
    sourceSlug: namespace,
    batchId: job.id,
    sentences: payloadSentences
  })
}

async function startLearning(job: JobRecord, client: TaxomindClient, namespace: string): Promise<string> {
  // New batches send the exact revision selected when queued. Legacy jobs read live labels.
  const inputs = await withWorkspace(job.workspaceId, () =>
    db().aILearningJobInput.findMany({
      where: { jobId: job.id },
      orderBy: { position: 'asc' },
      select: {
        annotations: true,
        sentence: {
          select: {
            ...sentenceFields,
            annotations: {
              where: { taxonomyId: job.taxonomyId, source: 'user' },
              select: { level: true, nodeCode: true },
              orderBy: { level: 'asc' }
            }
          }
        }
      }
    })
  )
  if (inputs.length === 0) throw new Error('No sentences to process')

  const sentencesPayload = inputs
    .map(({ sentence, annotations }) => ({
      sentenceId: sentence.id,
      fields: buildFieldMap(sentence),
      annotations: (annotations as LearningRequest['sentences'][number]['annotations'] | null) ?? sentence.annotations
    }))
    .filter(sentence => sentence.annotations.length > 0)
  if (sentencesPayload.length === 0) throw new Error('No valid annotations to send')

  return client.startLearningJob({
    taxonomyKey: job.taxonomy.key,
    sourceSlug: namespace,
    sentences: sentencesPayload
  })
}

/** Sends the taxonomy as Taxomind's TaxonomyRequest (it ignores descriptions and synonyms, so they are not sent). */
async function startSync(job: JobRecord, client: TaxomindClient, namespace: string): Promise<string> {
  const { taxonomy, nodes } = await withWorkspace(job.workspaceId, async () => ({
    taxonomy: await db().taxonomy.findUniqueOrThrow({
      where: { id: job.taxonomyId },
      select: { key: true, maxDepth: true, levelNames: true }
    }),
    nodes: await db().taxonomyNode.findMany({
      where: { taxonomyId: job.taxonomyId },
      select: {
        code: true,
        level: true,
        label: true,
        definition: true,
        examples: true,
        parentCode: true,
        isLeaf: true
      },
      orderBy: [{ level: 'asc' }, { code: 'asc' }]
    })
  }))
  if (nodes.length === 0) throw new Error('The taxonomy has no nodes to send')

  const levelNames: Record<string, string> = {}
  if (taxonomy.levelNames && typeof taxonomy.levelNames === 'object' && !Array.isArray(taxonomy.levelNames)) {
    for (const [level, name] of Object.entries(taxonomy.levelNames)) {
      if (typeof name === 'string') levelNames[level] = name
    }
  }

  return client.startTaxonomyJob({
    action: 'create',
    sourceSlug: namespace,
    taxonomy: {
      key: taxonomy.key,
      maxDepth: taxonomy.maxDepth,
      levelNames,
      nodes: nodes.map(node => ({
        code: node.code,
        level: node.level,
        label: node.label,
        definition: node.definition ?? '',
        examples: node.examples ?? '',
        parentCode: node.parentCode,
        isLeaf: node.isLeaf
      }))
    }
  })
}

async function startExternal(
  kind: JobKind,
  job: JobRecord,
  { client, namespace, endpointId }: Awaited<ReturnType<typeof connectionClient>>
) {
  const start = kind === 'learning' ? startLearning : kind === 'sync' ? startSync : startLabeling
  for (let attempt = 1; ; attempt++) {
    if (!(await claimLease(job.workspaceId, job.id, kind, START_LEASE_MS))) return null
    let externalJobId: string
    try {
      externalJobId = await start(job, client, namespace)
    } catch (error) {
      if (!(error instanceof TaxomindRequestError) || !error.retryable) throw error
      if (attempt >= START_ATTEMPTS) {
        const until = new Date(Date.now() + ENDPOINT_START_BACKOFF_MS)
        await prisma.aIEndpoint.updateMany({
          where: { id: endpointId, OR: [{ startBackoffUntil: null }, { startBackoffUntil: { lt: until } }] },
          data: { startBackoffUntil: until }
        })
        throw error
      }
      // Holding the admission slot while retrying prevents a brief outage from draining the queue.
      const delay = Math.min(60_000, Math.min(5_000, AI_JOB_POLL_INTERVAL_MS) * 2 ** (attempt - 1))
      logger.warn({ kind, jobId: job.id, attempt, delay, err: error }, 'AI job start will be retried')
      await wait(delay)
      continue
    }
    const startedAt = new Date()
    const saved = await withWorkspace(job.workspaceId, () =>
      jobTable(kind).updateMany({
        where: { id: job.id, status: 'processing', leaseOwner: monitorInstanceId() },
        data: { externalJobId, startedAt, errorMessage: null }
      })
    )
    if (saved.count > 0) return { externalJobId, startedAt }
    if (!(await isStillProcessing(job.workspaceId, job.id, kind))) {
      await client.cancelJob(API_RESOURCE[kind], externalJobId)
    }
    return null
  }
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
      if (!leased) return // finished, queued, or another instance owns it

      // Loaded after claiming, so a job another instance already started is
      // resumed (externalJobId set) rather than sent twice.
      const job = await loadJobRecord(workspaceId, jobId, kind)
      if (!job || job.status !== 'processing') return

      const connection = await connectionClient(workspaceId, job.connectionVersionId, job.requestId)
      const external = job.externalJobId
        ? { externalJobId: job.externalJobId, startedAt: job.startedAt }
        : await startExternal(kind, job, connection)

      if (external) await pollUntilComplete({ ...job, ...external }, external.externalJobId, connection.client, kind)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error({ kind, jobId, err: error }, 'AI job failed')
      try {
        if (leased) await failIfActive(workspaceId, jobId, kind, msg)
      } catch {
        /* best effort */
      }
    } finally {
      if (leased && !shuttingDown()) {
        await releaseLease(workspaceId, jobId, kind).catch(() => {
          /* expires on its own */
        })
      }
      monitors.delete(jobId)
      if (leased && !shuttingDown()) scheduleAIJobs()
    }
  })()
}

/**
 * Poll external AI for job status, update progress, store results on completion.
 */
async function pollUntilComplete(job: JobRecord, externalJobId: string, client: TaxomindClient, kind: JobKind) {
  const { workspaceId, id: jobId, taxonomyId } = job
  const deadline = job.startedAt.getTime() + AI_JOB_POLL_TIMEOUT_MS
  let consecutiveErrors = 0
  let importErrors = 0

  while (true) {
    let importing = false
    try {
      if (!(await claimLease(workspaceId, jobId, kind, POLL_LEASE_MS))) return
      if (Date.now() >= deadline) {
        const timedOut = await failIfActive(workspaceId, jobId, kind, 'AI job exceeded its maximum running time')
        if (timedOut) await client.cancelJob(API_RESOURCE[kind], externalJobId)
        return
      }
      const status = await client.fetchJobStatus(API_RESOURCE[kind], externalJobId)

      if (job.totalSentences !== null) {
        const progress = status.progress ?? 0
        await updateJobRecord(workspaceId, jobId, kind, {
          processedSentences: Math.round(progress * job.totalSentences)
        })
      }

      if (status.status === 'completed') {
        importing = true
        // Completion is a conditional transition: if the job was cancelled while
        // we waited for the service, nothing is written. Results and status
        // commit together, and only while the workspace is active (write: an
        // archived workspace refuses them).
        const completed = await withWorkspace(
          workspaceId,
          async () => {
            const tx = db()
            if (kind === 'learning') await lockLearningTaxonomy(taxonomyId)
            const data: Record<string, unknown> = {
              status: 'completed',
              completedAt: new Date(),
              errorMessage: null,
              leaseOwner: null,
              leaseExpiresAt: null
            }
            if (job.totalSentences !== null) data.processedSentences = job.totalSentences
            const claimed = await jobTable(kind).updateMany({
              where: { id: jobId, status: 'processing', leaseOwner: monitorInstanceId() },
              data
            })
            if (claimed.count === 0) return false
            if (kind === 'labeling') {
              await storeLabelingResults(tx, workspaceId, jobId, taxonomyId, status.result)
              await audit({
                actorId: null,
                action: 'ai.results_saved',
                entityType: 'ai_job',
                entityId: jobId,
                payload: { taxonomyId }
              })
            }
            if (kind === 'learning') {
              await creditLearningBatch(taxonomyId, jobId)
              await settleLearningRun(taxonomyId)
            }
            return true
          },
          { write: true, timeoutMs: 120_000 }
        )
        if (!completed) return

        return
      }

      if (status.status === 'failed') {
        await failIfActive(workspaceId, jobId, kind, 'External AI job failed')
        return
      }

      // Cancelled on Taxomind's side. When the cancel came from classiflow, the
      // job still ends up cancelled: the cancel routes write that status
      // unconditionally, and failIfActive leaves a cancelled job alone.
      if (status.status === 'canceled') {
        await failIfActive(workspaceId, jobId, kind, 'External AI job was cancelled in the AI service')
        return
      }
      consecutiveErrors = 0
    } catch (error) {
      if (importing && ++importErrors >= RESULT_IMPORT_ATTEMPTS) {
        await failIfActive(workspaceId, jobId, kind, 'Could not save the AI job results after three attempts')
        return
      }
      consecutiveErrors++
      logger.warn({ kind, jobId, consecutiveErrors, err: error }, 'AI job status request failed')
    }

    const delay = Math.min(pollDelay(consecutiveErrors), Math.max(1_000, deadline - Date.now()))
    try {
      if (!(await claimLease(workspaceId, jobId, kind, delay + POLL_LEASE_MS))) return
    } catch (error) {
      logger.warn({ kind, jobId, err: error }, 'Could not renew AI job lease before the next poll')
      await wait(Math.min(delay, 30_000))
      continue
    }
    await wait(delay)
  }
}

/** Poll interval, doubled per consecutive failed status request (capped). */
export function pollDelay(consecutiveErrors: number): number {
  return Math.min(
    AI_JOB_POLL_INTERVAL_MS * 2 ** consecutiveErrors,
    Math.max(MAX_POLL_BACKOFF_MS, AI_JOB_POLL_INTERVAL_MS)
  )
}

/** Marks a job failed unless it already reached a final state (e.g. cancelled). */
async function failIfActive(workspaceId: string, jobId: string, kind: JobKind, message: string) {
  const where = { id: jobId, status: 'processing', leaseOwner: monitorInstanceId() }
  const data = {
    status: 'failed',
    errorMessage: message,
    completedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null
  }
  return withWorkspace(
    workspaceId,
    async () => {
      const learning =
        kind === 'learning' &&
        (await db().aILearningJob.findUnique({ where: { id: jobId }, select: { taxonomyId: true } }))
      if (learning) await lockLearningTaxonomy(learning.taxonomyId)
      const changed = await jobTable(kind).updateMany({ where, data })
      if (changed.count === 0) return false
      if (learning) await settleLearningRun(learning.taxonomyId)
      await audit({ actorId: null, action: 'ai.job_failed', entityType: 'ai_job', entityId: jobId, payload: { kind } })
      return true
    },
    { write: true }
  )
}

/**
 * Validates the completed labeling job's result (lib/contracts/taxomind.ts)
 * and stores the suggestions, inside the completion transaction. Only the
 * job's input records (AILabelingJobInput, read here, not from the result or
 * memory) are touched. Accept contiguous suggestions along the hierarchy,
 * including partial paths and a suffix of level-specific unknown codes.
 */
async function storeLabelingResults(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  jobId: string,
  taxonomyId: string,
  result: unknown
) {
  const inputs = await tx.aILabelingJobInput.findMany({ where: { jobId }, select: { sentenceId: true } })
  const { bySentence, rejected, serviceErrors } = parseLabelingResults(
    result,
    inputs.map(i => i.sentenceId)
  )

  const codes = new Set<string>()
  bySentence.forEach(list => list.forEach(s => codes.add(s.nodeCode)))
  const taxonomy = await tx.taxonomy.findUniqueOrThrow({ where: { id: taxonomyId }, select: { maxDepth: true } })
  const codeList = Array.from(codes)
  const known = new Map<string, { level: number; parentCode: string | null }>()
  const chunkSize = 1000
  for (let offset = 0; offset < codeList.length; offset += chunkSize) {
    const nodes = await tx.taxonomyNode.findMany({
      where: { taxonomyId, code: { in: codeList.slice(offset, offset + chunkSize) } },
      select: { code: true, level: true, parentCode: true }
    })
    for (const node of nodes) known.set(node.code, node)
  }
  let invalidPaths = 0
  const data: Prisma.SentenceAISuggestionCreateManyInput[] = []

  for (const [sentenceId, suggestions] of bySentence) {
    const sorted = [...suggestions].sort((a, b) => a.level - b.level)
    const valid = sorted.every(({ level, nodeCode }, index) => {
      if (level !== index + 1 || level > taxonomy.maxDepth) return false
      if (nodeCode === getUnknownCodeForLevel(level)) return true
      const node = known.get(nodeCode)
      return node?.level === level && node.parentCode === (sorted[index - 1]?.nodeCode ?? null)
    })
    if (!valid) {
      invalidPaths++
      continue
    }
    data.push(
      ...sorted.map(s => ({
        workspaceId,
        sentenceId,
        taxonomyId,
        level: s.level,
        nodeCode: s.nodeCode,
        confidenceScore: s.confidence
      }))
    )
  }
  const returnedIds = Array.from(bySentence.keys())
  for (let offset = 0; offset < returnedIds.length; offset += chunkSize) {
    await tx.sentenceAISuggestion.deleteMany({
      where: { taxonomyId, sentenceId: { in: returnedIds.slice(offset, offset + chunkSize) } }
    })
  }
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    await tx.sentenceAISuggestion.createMany({ data: data.slice(offset, offset + chunkSize) })
  }

  if (rejected > 0 || invalidPaths > 0) {
    logger.warn(
      { jobId, rejected, invalidPaths },
      'Dropped labeling results for invalid taxonomy paths or records outside the job'
    )
  }
  const failedSentences = serviceErrors + rejected + invalidPaths
  if (failedSentences > 0) {
    await tx.aILabelingJob.update({ where: { id: jobId }, data: { failedSentences } })
  }
}
