import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { CurrentUser } from '@/lib/api-auth'
import { AI_UNAVAILABLE_MESSAGES, connectionForNewJobs, workspaceJobSettings } from '@/lib/ai-connections'
import { scheduleAIJobs } from '@/lib/ai-job-monitor'
import { lockSentences } from '@/lib/annotation-status'
import { audit } from '@/lib/audit'
import { queueAIResult, type QueueAIPreview, type QueueAIRequest, type QueueAIResult } from '@/lib/contracts/ai-queue'
import { Prisma } from '@/lib/generated/prisma/client'
import { loadQueueUrlState, queueMatchParams } from '@/lib/queue-url'
import { currentRequestId } from '@/lib/request-id'
import { activeLabelingJob, createLabelingJobs, labelingRecordLimit, lockLabelingTaxonomies } from './ai-labeling-jobs'
import { PARTICIPATING } from './double-annotation'
import { queueFilterError, queueSelectionWhere } from './sentences'
import { afterCommit, db } from '@/lib/workspace/db'

const ENTITY_TYPE = 'queue_ai_selection'
const ACTION = 'ai.labeling_started'

export class QueueAIError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message)
  }
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function changedSelection(): never {
  throw new QueueAIError('Records, suggestions or AI settings changed. Preview the jobs again.', 409)
}

type TaxonomyOptions = {
  connectionId: string
  taxonomies: Array<{ id: string; key: string; syncId: string | null }>
}

async function availableTaxonomies(keys?: string[]): Promise<TaxonomyOptions | { unavailable: string }> {
  const connection = await connectionForNewJobs()
  if ('unavailable' in connection) {
    return { unavailable: AI_UNAVAILABLE_MESSAGES[connection.unavailable] }
  }
  const destination = await db().aIConnectionVersion.findUniqueOrThrow({
    where: { id: connection.id },
    select: { endpointId: true, namespace: true }
  })
  // A rotated credential keeps the same model. A different endpoint or namespace needs its own sync.
  const taxonomies = await db().taxonomy.findMany({
    where: { isActive: true, ...(keys ? { key: { in: keys } } : {}) },
    orderBy: { key: 'asc' },
    select: {
      id: true,
      key: true,
      aiSyncJobs: {
        where: { connection: destination },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true, status: true }
      }
    }
  })
  return {
    connectionId: connection.id,
    taxonomies: taxonomies.map(({ id, key, aiSyncJobs: [sync] }) => ({
      id,
      key,
      syncId: sync?.status === 'completed' ? sync.id : null
    }))
  }
}

export async function getQueueAIOptions() {
  const options = await availableTaxonomies()
  if ('unavailable' in options) return { unavailable: options.unavailable, taxonomies: [] }
  return { taxonomies: options.taxonomies.map(({ key, syncId }) => ({ key, ready: syncId !== null })) }
}

async function readyTaxonomies(keys: string[]) {
  const options = await availableTaxonomies(keys)
  if ('unavailable' in options) throw new QueueAIError(options.unavailable, 409)
  if (options.taxonomies.length !== keys.length || options.taxonomies.some(taxonomy => !taxonomy.syncId)) {
    throw new QueueAIError('Choose active taxonomies synced to the current AI service.', 409)
  }
  return options
}

async function planJobs(
  user: CurrentUser,
  params: URLSearchParams,
  options: Awaited<ReturnType<typeof readyTaxonomies>>,
  skipExisting: boolean
) {
  const base = await queueSelectionWhere(user, params)
  const safe = {
    AND: [base, { doubleRounds: { none: { status: 'active' } }, doubleTasks: { none: PARTICIPATING } }]
  } satisfies Prisma.SentenceWhereInput
  const { labelingBatchSize: batchSize } = await workspaceJobSettings()
  const limit = labelingRecordLimit(batchSize)
  const matched = await db().sentence.count({ where: base })
  const sendable = await db().sentence.count({ where: safe })
  const plans = []
  for (const taxonomy of options.taxonomies) {
    const active = activeLabelingJob(taxonomy.id)
    const available = { AND: [safe, { labelingJobs: { none: active } }] }
    const suggestion = { aiSuggestions: { some: { taxonomyId: taxonomy.id } } }
    const where = { AND: [available, ...(skipExisting ? [{ NOT: suggestion }] : [])] }
    const ids = (
      await db().sentence.findMany({
        where,
        select: { id: true },
        take: limit + 1,
        orderBy: [{ importOrder: 'asc' }, { id: 'asc' }]
      })
    ).map(record => record.id)
    const eligible = ids.length > limit ? await db().sentence.count({ where }) : ids.length
    const existing = await db().sentence.count({ where: { AND: [available, suggestion] } })
    const alreadyQueued = await db().sentence.count({ where: { AND: [safe, { labelingJobs: { some: active } }] } })
    plans.push({
      taxonomy,
      ids,
      summary: {
        key: taxonomy.key,
        eligible,
        alreadyQueued,
        existing,
        jobs: Math.ceil(eligible / batchSize),
        limit
      }
    })
  }
  return { batchSize, matched, protected: Math.max(0, matched - sendable), plans }
}

export async function queueAIJobs(user: CurrentUser, request: QueueAIRequest): Promise<QueueAIPreview | QueueAIResult> {
  const { queue, taxonomyKeys, skipExisting, confirmation } = request
  const keys = [...new Set(taxonomyKeys)].sort()
  if (keys.length !== taxonomyKeys.length) throw new QueueAIError('Choose distinct taxonomies.', 400)
  const params = new URLSearchParams(queueMatchParams(await loadQueueUrlState(new URLSearchParams(queue))))
  const filterError = queueFilterError(params)
  if (filterError) throw new QueueAIError(filterError, 400)

  const id = confirmation?.id ?? randomUUID()
  const requestHash = digest([user.workspaceId, user.id, id, params.toString(), keys, skipExisting])
  if (confirmation) {
    await db().$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('classiflow.queue-ai.' || ${id}))`
    const receipt = await db().auditLog.findFirst({
      where: { action: ACTION, entityType: ENTITY_TYPE, entityId: id, actorId: user.id },
      select: { payload: true }
    })
    if (receipt) {
      const payload = receipt.payload
      if (
        payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        payload.requestHash === requestHash &&
        payload.fingerprint === confirmation.fingerprint
      ) {
        return queueAIResult.parse(payload.result)
      }
      changedSelection()
    }
  }

  let options = await readyTaxonomies(keys)
  if (confirmation) {
    const ids = options.taxonomies.map(taxonomy => taxonomy.id).sort()
    await lockLabelingTaxonomies(ids)
    await db().$queryRaw`SELECT id FROM "Taxonomy" WHERE "workspaceId" = ${user.workspaceId}
      AND id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
    options = await readyTaxonomies(keys)
    if (
      options.taxonomies
        .map(taxonomy => taxonomy.id)
        .sort()
        .some((id, index) => id !== ids[index])
    )
      changedSelection()
  }

  let plan = await planJobs(user, params, options, skipExisting)
  if (confirmation) {
    if (plan.plans.some(({ summary }) => summary.eligible > summary.limit)) changedSelection()
    const ids = [...new Set(plan.plans.flatMap(taxonomy => taxonomy.ids))].sort()
    const locked = new Set(ids)
    for (let offset = 0; offset < ids.length; offset += 1_000)
      await lockSentences(db(), ids.slice(offset, offset + 1_000))
    plan = await planJobs(user, params, options, skipExisting)
    if (plan.plans.some(taxonomy => taxonomy.ids.some(id => !locked.has(id)))) changedSelection()
  }

  const taxonomies = plan.plans.map(({ summary }) => summary)
  const summary = { matched: plan.matched, protected: plan.protected, taxonomies }
  const ready =
    taxonomies.some(taxonomy => taxonomy.jobs > 0) && taxonomies.every(taxonomy => taxonomy.eligible <= taxonomy.limit)
  const fingerprint = digest([
    requestHash,
    options.connectionId,
    plan.batchSize,
    plan.matched,
    plan.protected,
    plan.plans
  ])
  if (!confirmation) return { ...summary, confirmation: ready ? { id, fingerprint } : null }
  if (!ready || confirmation.fingerprint !== fingerprint) changedSelection()

  const requestId = await currentRequestId()
  for (const item of plan.plans) {
    if (item.ids.length === 0) continue
    await createLabelingJobs({
      workspaceId: user.workspaceId,
      actorId: user.id,
      taxonomyId: item.taxonomy.id,
      connectionVersionId: options.connectionId,
      sentenceIds: item.ids,
      batchSize: plan.batchSize,
      requestId,
      filterCriteria: { selection: 'queue', skipExisting }
    })
  }
  const result = {
    jobs: taxonomies.reduce((total, item) => total + item.jobs, 0),
    taxonomies: taxonomies.map(({ key, eligible, jobs }) => ({ key, records: eligible, jobs }))
  }
  await audit({
    actorId: user.id,
    action: ACTION,
    entityType: ENTITY_TYPE,
    entityId: id,
    payload: { requestHash, fingerprint, result }
  })
  afterCommit(scheduleAIJobs)
  return result
}
