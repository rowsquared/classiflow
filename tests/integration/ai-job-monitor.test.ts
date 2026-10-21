import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AIConnectionVersion, Taxonomy, User } from '@/lib/generated/prisma/client'
import openapi from '@/lib/contracts/taxomind.openapi.json'
import { db } from '@/lib/workspace/db'
import {
  prisma,
  wsId,
  inWorkspace,
  createAIConnection,
  createWorkspace,
  createSentences,
  createTaxonomy,
  createUser,
  params,
  request,
  resetDatabase,
  signInAs
} from './helpers'

// The contract test: the monitor and the taxonomy sync against a stub Taxomind
// on a local port. The stub checks every request classiflow sends, and every
// reply it gives, against Taxomind's OpenAPI document
// (lib/contracts/taxomind.openapi.json); a request that breaks the contract is
// answered 422 as Taxomind would and fails the test. Tests that need a
// malformed reply send it `raw`, past the check.
//
// Every job runs through the workspace's connection version (an approved
// endpoint at the stub's address, credential `stub-key`).
//
// Poll fast; the modules read these at load time, so they are imported after
// the stub listens (beforeAll).
vi.hoisted(() => {
  process.env.AI_JOB_POLL_INTERVAL_MS = '20'
  process.env.AI_JOB_POLL_TIMEOUT_MS = '10000'
  process.env.AI_SOURCE_SLUG = 'stub-deployment'
  process.env.AI_CREDENTIALS_KEYS = 'k2026:MlYB0Tmfes0OCnkWHxv/4MwbwWkWUTFZAj7YUvaDDcg='
})

type SchemaName = keyof typeof openapi.components.schemas
const defs = JSON.parse(JSON.stringify(openapi.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'))
const contract = (name: SchemaName) => z.fromJSONSchema({ $defs: defs, ...defs[name] })

type Resource = 'label' | 'learn' | 'taxonomies'
const SCHEMAS: Record<Resource, { request: SchemaName; created: SchemaName; status: SchemaName }> = {
  label: { request: 'LabelingRequest', created: 'LabelingJobResponse', status: 'LabelingStatusResponse' },
  learn: { request: 'LearningRequest', created: 'LearningJobResponse', status: 'LearningStatusResponse' },
  taxonomies: { request: 'TaxonomyRequest', created: 'TaxonomyJobResponse', status: 'TaxonomyStatusResponse' }
}

type StubJob = { resource: Resource; body: Record<string, unknown>; polls: number }
/** Status fields to send (merged into a complete status response), or a `raw` body sent as is. */
type Reply = { code?: number; body?: Record<string, unknown>; raw?: string }
type StatusReply = (job: StubJob) => Reply

let server: Server
let monitor: typeof import('@/lib/ai-job-monitor')
let ai: typeof import('@/lib/ai-labeling')
let syncRoute: typeof import('@/app/api/workspaces/[workspaceId]/taxonomies/[key]/sync-ai/route')
let labelRoute: typeof import('@/app/api/workspaces/[workspaceId]/ai-labeling/jobs/route')
let cancelRoute: typeof import('@/app/api/workspaces/[workspaceId]/ai-jobs/[jobId]/cancel/route')
let workspaceRoute: typeof import('@/app/api/workspaces/[workspaceId]/route')
let stubUrl: string
const started: StubJob[] = []
const cancels: string[] = []
let allowedAuth = new Set(['Bearer stub-key'])
let statusReply: StatusReply
let createdReply: ((resource: Resource) => Reply) | undefined
let authHeaders: string[] = []
let violations: string[] = []

const now = () => new Date().toISOString()

function send(res: ServerResponse, code: number, body: unknown, raw?: string) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(raw ?? JSON.stringify(body))
}

/** Sends a reply that must itself satisfy the contract, so the stub cannot drift from Taxomind. */
function reply(res: ServerResponse, schema: SchemaName, body: Record<string, unknown>, code = 200) {
  const checked = contract(schema).safeParse(body)
  if (!checked.success) violations.push(`stub reply ${schema}: ${checked.error.message}`)
  send(res, code, body)
}

function createdBody(resource: Resource, job: StubJob, id: string) {
  if (resource === 'learn') {
    return {
      jobId: id,
      status: 'pending',
      taxonomyKey: String(job.body.taxonomyKey),
      message: 'Learning job initiated',
      createdAt: now()
    }
  }
  return {
    job_id: id,
    ...(resource === 'label' ? { batch_id: String(job.body.batchId) } : {}),
    status: 'pending',
    message: 'Job started',
    created_at: now()
  }
}

function statusBody(resource: Resource, job: StubJob, id: string, fields: Record<string, unknown>) {
  if (resource === 'learn') {
    return { jobId: id, taxonomyKey: String(job.body.taxonomyKey), message: 'Learning', createdAt: now(), ...fields }
  }
  return {
    job_id: id,
    ...(resource === 'label' ? { batch_id: String(job.body.batchId) } : {}),
    created_at: now(),
    ...fields
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  authHeaders.push(String(req.headers.authorization))
  let raw = ''
  for await (const chunk of req) raw += chunk
  const url = req.url || ''

  const start = url.match(/^\/(label|learn|taxonomies)$/)
  if (req.method === 'POST' && start) {
    const resource = start[1] as Resource
    const body = JSON.parse(raw || '{}')
    const checked = contract(SCHEMAS[resource].request).safeParse(body)
    if (!checked.success) {
      violations.push(`POST ${url}: ${checked.error.message}`)
      return send(res, 422, { detail: checked.error.issues })
    }
    const job: StubJob = { resource, body, polls: 0 }
    started.push(job)
    const override = createdReply?.(resource)
    if (override) return send(res, override.code ?? 202, override.body, override.raw)
    return reply(res, SCHEMAS[resource].created, createdBody(resource, job, `ext-${started.length}`), 202)
  }

  const status = url.match(/^\/(label|learn|taxonomies)\/ext-(\d+)\/(status|cancel)$/)
  const job = status && started[Number(status[2]) - 1]
  if (status && job && job.resource === status[1]) {
    if (status[3] === 'cancel' && req.method === 'POST') {
      cancels.push(url)
      return reply(
        res,
        SCHEMAS[job.resource].status,
        statusBody(job.resource, job, `ext-${status[2]}`, { status: 'canceled' })
      )
    }
    if (status[3] === 'status' && req.method === 'GET') {
      job.polls++
      const answer = statusReply(job)
      if (answer.raw !== undefined || (answer.code ?? 200) !== 200) {
        return send(res, answer.code ?? 200, answer.body, answer.raw)
      }
      return reply(
        res,
        SCHEMAS[job.resource].status,
        statusBody(job.resource, job, `ext-${status[2]}`, answer.body ?? {})
      )
    }
  }
  send(res, 404, { detail: 'Not Found' })
}

beforeAll(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, {}))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  monitor = await import('@/lib/ai-job-monitor')
  ai = await import('@/lib/ai-labeling')
  syncRoute = await import('@/app/api/workspaces/[workspaceId]/taxonomies/[key]/sync-ai/route')
  labelRoute = await import('@/app/api/workspaces/[workspaceId]/ai-labeling/jobs/route')
  cancelRoute = await import('@/app/api/workspaces/[workspaceId]/ai-jobs/[jobId]/cancel/route')
  workspaceRoute = await import('@/app/api/workspaces/[workspaceId]/route')
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

let admin: User
let taxonomy: Taxonomy
let connection: AIConnectionVersion

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  await createWorkspace()
  await createWorkspace()
  started.length = 0
  cancels.length = 0
  allowedAuth = new Set(['Bearer stub-key'])
  authHeaders = []
  violations = []
  createdReply = undefined
  admin = await createUser('admin')
  taxonomy = await createTaxonomy('ISCO')
  connection = await createAIConnection({ baseUrl: stubUrl, credential: 'stub-key' })
  // Recovery is rate-limited per process; each test starts with a fresh window.
  ;(globalThis as { __lastRecoveryCheck?: number }).__lastRecoveryCheck = 0
})

afterEach(async () => {
  expect(violations).toEqual([])
  expect(authHeaders.filter(h => !allowedAuth.has(h))).toEqual([])
  // Let monitors and admission from this test finish before the next test
  // truncates the tables, so they cannot deadlock with its setup.
  const state = globalThis as {
    __aiShuttingDown?: boolean
    __activeJobMonitors?: Set<string>
    __aiAdmission?: { running: boolean }
  }
  state.__aiShuttingDown = true
  try {
    await vi.waitFor(
      () => {
        expect(state.__activeJobMonitors?.size ?? 0).toBe(0)
        expect(state.__aiAdmission?.running ?? false).toBe(false)
      },
      { timeout: 20_000, interval: 50 }
    )
  } finally {
    state.__aiShuttingDown = false
  }
})

const ACTIVE = ['pending', 'processing']

/** A queued labeling job for these records (its input rows), on the current connection. */
async function labelingJob(sentenceIds: string[], extra: Record<string, unknown> = {}) {
  return inWorkspace(async () => {
    const job = await db().aILabelingJob.create({
      data: {
        workspaceId: wsId(),
        createdById: admin.id,
        taxonomyId: taxonomy.id,
        connectionVersionId: connection.id,
        totalSentences: sentenceIds.length,
        ...extra
      }
    })
    await db().aILabelingJobInput.createMany({
      data: sentenceIds.map((sentenceId, position) => ({ workspaceId: wsId(), jobId: job.id, sentenceId, position }))
    })
    return job
  })
}

/** Admits queued jobs and starts their monitors, as routes do after commit. */
const run = () => monitor.admitQueuedJobs()

/** Waits until the job leaves pending/processing (or the predicate holds). */
async function settle(id: string, done = (status: string) => !ACTIVE.includes(status)) {
  for (let i = 0; i < 250; i++) {
    const job = await prisma.aILabelingJob.findUniqueOrThrow({ where: { id } })
    if (done(job.status)) return job
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error(`job ${id} did not settle`)
}

const completedWith =
  (suggestions: unknown, errors: unknown[] = []): StatusReply =>
  job => ({ body: { status: 'completed', progress: 1, result: { batchId: job.body.batchId, suggestions, errors } } })

const storedSuggestions = async () =>
  (await prisma.sentenceAISuggestion.findMany({ orderBy: [{ sentenceId: 'asc' }, { level: 'asc' }] })).map(s => [
    s.sentenceId,
    s.level,
    s.nodeCode,
    s.confidenceScore
  ])

describe('AI job monitor against a stub service', () => {
  it('sends the records, polls to completion and stores only valid suggestions', async () => {
    const [a, b, outside] = await createSentences(3)
    statusReply = job =>
      job.polls < 3
        ? { body: { status: 'running', progress: 0.5 } }
        : completedWith([
            {
              sentenceId: a.id,
              annotations: [
                { level: 1, nodeCode: '01', confidence: 0.9 },
                { level: 2, nodeCode: '011', confidence: 0.8 }
              ]
            },
            { sentenceId: b.id, annotations: [{ level: 1, nodeCode: '99', confidence: 0.7 }] }, // not in the taxonomy
            { sentenceId: 'someone-else', annotations: [{ level: 1, nodeCode: '02', confidence: 0.5 }] }, // foreign record
            { sentenceId: outside.id, annotations: [{ level: 1, nodeCode: '02', confidence: 0.5 }] } // not in the job's input
          ])(job)
    const job = await labelingJob([a.id, b.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.externalJobId).toBe('ext-1')
    expect(done.failedSentences).toBe(2)
    expect(done.leaseOwner).toBeNull()
    expect(started).toHaveLength(1)
    expect(started[0]?.body).toEqual({
      taxonomyKey: 'ISCO',
      sourceSlug: `stub-deployment--${wsId()}`,
      batchId: job.id,
      sentences: [
        { sentence_id: a.id, fields: { text: 'record 0' } },
        { sentence_id: b.id, fields: { text: 'record 1' } }
      ]
    })
    expect(await storedSuggestions()).toEqual([
      [a.id, 1, '01', 0.9],
      [a.id, 2, '011', 0.8]
    ])
  })

  it('keeps codes as strings: leading zeros and the unknown codes', async () => {
    const [a, b] = await createSentences(2)
    statusReply = completedWith([
      {
        sentenceId: a.id,
        annotations: [
          { level: 1, nodeCode: '01', confidence: 0.6 },
          { level: 2, nodeCode: '012', confidence: 0.4 }
        ]
      },
      {
        sentenceId: b.id,
        annotations: [
          { level: 1, nodeCode: '-9', confidence: 0.2 },
          { level: 2, nodeCode: '-99', confidence: 0.1 }
        ]
      }
    ])
    const job = await labelingJob([a.id, b.id])

    await run()
    expect((await settle(job.id)).status).toBe('completed')

    const stored = await storedSuggestions()
    expect(stored).toHaveLength(4)
    expect(stored).toEqual(
      expect.arrayContaining([
        [a.id, 1, '01', 0.6],
        [a.id, 2, '012', 0.4],
        [b.id, 1, '-9', 0.2],
        [b.id, 2, '-99', 0.1]
      ])
    )
  })

  it('marks the job failed with the service error', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'failed', error: 'model not trained' } })
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('model not trained')
  })

  it('marks the job failed when Taxomind cancelled it', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'canceled' } })
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('External AI job was cancelled in the AI service')
  })

  it('keeps a job cancelled while polling cancelled and writes no suggestions', async () => {
    const [a] = await createSentences(1)
    let cancelled = false
    statusReply = job =>
      cancelled
        ? completedWith([{ sentenceId: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 1 }] }])(job)
        : { body: { status: 'running' } }
    const job = await labelingJob([a.id])

    await run()
    await settle(job.id, status => status === 'processing')
    await inWorkspace(() => db().aILabelingJob.update({ where: { id: job.id }, data: { status: 'cancelled' } }))
    cancelled = true
    await new Promise(r => setTimeout(r, 200))

    expect((await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('cancelled')
    expect(await prisma.sentenceAISuggestion.count()).toBe(0)
  })

  it('keeps polling through failed status requests', async () => {
    const [a] = await createSentences(1)
    statusReply = job =>
      job.polls <= 2
        ? { code: 503, body: { detail: 'busy' } }
        : completedWith([{ sentenceId: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 1 }] }])(job)
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(started[0]?.polls).toBe(3)
  })

  it('treats malformed status responses like failed requests and keeps polling', async () => {
    const [a] = await createSentences(1)
    const malformed: Reply[] = [
      { raw: 'Internal Server Error' }, // not JSON
      { raw: JSON.stringify({ job_id: 'ext-1' }) }, // no status
      { raw: JSON.stringify({ status: 'done' }) }, // not one of Taxomind's statuses
      { raw: JSON.stringify({ status: 'success' }) } // an old alias Taxomind never sends
    ]
    statusReply = job =>
      malformed[job.polls - 1] ??
      completedWith([{ sentenceId: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 1 }] }])(job)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(started[0]?.polls).toBe(5)
    const messages = warn.mock.calls.map(call => String(call[0]))
    expect(messages.some(m => m.includes('not JSON'))).toBe(true)
    expect(
      messages.some(m => m.includes('Unexpected response from the AI service (GET /label/ext-1/status): status'))
    ).toBe(true)
    warn.mockRestore()
  })

  it('stores what is valid from a partial result', async () => {
    const [a, b, c] = await createSentences(3)
    // Taxomind validates its result, so this reply is off-contract on purpose:
    // one usable record, one with a numeric code, one missing.
    statusReply = () => ({
      raw: JSON.stringify({
        job_id: 'ext-1',
        batch_id: 'x',
        status: 'completed',
        created_at: now(),
        result: {
          suggestions: [
            { sentenceId: a.id, annotations: [{ level: 1, nodeCode: '01', confidence: 0.5 }] },
            { sentenceId: b.id, annotations: [{ level: 1, nodeCode: 1, confidence: 0.5 }] }
          ]
        }
      })
    })
    const job = await labelingJob([a.id, b.id, c.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.failedSentences).toBe(1)
    expect(await storedSuggestions()).toEqual([[a.id, 1, '01', 0.5]])
  })

  it('completes without suggestions when a completed job has no result', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'completed', result: null } })
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.failedSentences).toBe(0)
    expect(await prisma.sentenceAISuggestion.count()).toBe(0)
  })

  it('fails the job when the start response has no job id', async () => {
    const [a] = await createSentences(1)
    createdReply = () => ({ body: { jobId: 'wrong-key', status: 'pending' } })
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.externalJobId).toBeNull()
    expect(done.errorMessage).toBe(
      'Unexpected response from the AI service (POST /label): job_id: Invalid input: expected string, received undefined'
    )
  })

  it("fails the job with the service's answer when the start request is refused", async () => {
    const [a] = await createSentences(1)
    createdReply = () => ({ code: 401, body: { detail: 'Invalid token' } })
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    const job = await labelingJob([a.id])

    await run()
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('AI labeling API error (401): {"detail":"Invalid token"}')
  })

  it('leaves a job alone while another instance holds its lease', async () => {
    const [a] = await createSentences(1)
    statusReply = completedWith([])
    const job = await labelingJob([a.id], {
      status: 'processing',
      leaseOwner: 'other-instance',
      leaseExpiresAt: new Date(Date.now() + 60_000)
    })

    await monitor.ensureJobsMonitored()
    await new Promise(r => setTimeout(r, 200))

    expect(started).toHaveLength(0)
    const after = await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(after).toMatchObject({ status: 'processing', leaseOwner: 'other-instance' })
  })

  it("takes over a dead instance's job and resumes polling without resending it", async () => {
    const [a] = await createSentences(1)
    // Another instance started the external job, then died: its lease expired.
    started.push({ resource: 'label', body: { taxonomyKey: 'ISCO', batchId: 'earlier' }, polls: 0 })
    statusReply = completedWith([{ sentenceId: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 0.5 }] }])
    const job = await labelingJob([a.id], {
      status: 'processing',
      externalJobId: 'ext-1',
      leaseOwner: 'dead-instance',
      leaseExpiresAt: new Date(Date.now() - 1000)
    })

    await monitor.ensureJobsMonitored()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(started).toHaveLength(1) // polled, not sent again
    expect(await prisma.sentenceAISuggestion.count()).toBe(1)
  })

  it("runs a learning job and records the taxonomy's last learning", async () => {
    const [a] = await createSentences(1)
    await inWorkspace(() =>
      db().sentenceAnnotation.createMany({
        data: [
          {
            workspaceId: wsId(),
            sentenceId: a.id,
            taxonomyId: taxonomy.id,
            level: 1,
            nodeCode: '01',
            source: 'user',
            createdById: admin.id
          },
          {
            workspaceId: wsId(),
            sentenceId: a.id,
            taxonomyId: taxonomy.id,
            level: 2,
            nodeCode: '011',
            source: 'user',
            createdById: admin.id
          }
        ]
      })
    )
    statusReply = () => ({ body: { status: 'completed' } })
    const job = await inWorkspace(async () => {
      const created = await db().aILearningJob.create({
        data: {
          workspaceId: wsId(),
          createdById: admin.id,
          taxonomyId: taxonomy.id,
          connectionVersionId: connection.id,
          totalSentences: 1
        }
      })
      await db().aILearningJobInput.create({
        data: { workspaceId: wsId(), jobId: created.id, sentenceId: a.id, position: 0 }
      })
      return created
    })

    await run()
    await expect
      .poll(async () => (await prisma.aILearningJob.findUniqueOrThrow({ where: { id: job.id } })).status)
      .toBe('completed')

    const done = await prisma.aILearningJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.externalJobId).toBe('ext-1') // read from `jobId`, the learning endpoint's key
    expect(started[0]?.resource).toBe('learn')
    expect(started[0]?.body).toEqual({
      taxonomyKey: 'ISCO',
      sourceSlug: `stub-deployment--${wsId()}`,
      sentences: [
        {
          sentenceId: a.id,
          fields: { text: 'record 0' },
          annotations: [
            { level: 1, nodeCode: '01' },
            { level: 2, nodeCode: '011' }
          ]
        }
      ]
    })
    // Recorded right after the job's completion, outside its transaction.
    await expect
      .poll(async () => (await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxonomy.id } })).lastLearningStatus)
      .toBe('completed')
  })
})

describe('taxonomy sync against a stub service', () => {
  const sync = () =>
    syncRoute.POST(
      request(`/api/workspaces/${wsId()}/taxonomies/ISCO/sync-ai`, { method: 'POST' }),
      params({ key: 'ISCO' })
    )
  const syncJob = () => prisma.aITaxonomySyncJob.findFirstOrThrow({ orderBy: { startedAt: 'desc' } })

  it('queues a sync job, sends the taxonomy as the contract describes it and records completion', async () => {
    signInAs(admin)
    statusReply = job => ({ body: job.polls < 2 ? { status: 'running' } : { status: 'completed', progress: 1 } })

    const res = await sync()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, status: 'pending' })

    await expect.poll(async () => (await syncJob()).status).toBe('completed')
    const job = await syncJob()
    expect(job).toMatchObject({ id: body.jobId, externalJobId: 'ext-1', connectionVersionId: connection.id })
    const sent = started[0]?.body as {
      action: string
      sourceSlug: string
      taxonomy: Record<string, unknown> & { nodes: Array<{ code: string }> }
    }
    expect(sent).toMatchObject({
      action: 'create',
      sourceSlug: `stub-deployment--${wsId()}`,
      taxonomy: { key: 'ISCO', maxDepth: 2 }
    })
    // Only what Taxomind reads (TaxonomyRequest): no description, no synonyms.
    expect(Object.keys(sent.taxonomy).sort()).toEqual(['key', 'levelNames', 'maxDepth', 'nodes'])
    expect(sent.taxonomy.nodes.map(n => n.code).sort()).toEqual(['01', '011', '012', '02'])
  })

  it('refuses a second sync while one is queued or running', async () => {
    signInAs(admin)
    statusReply = () => ({ body: { status: 'running' } })
    expect((await sync()).status).toBe(200)
    expect((await sync()).status).toBe(409)
    await cancelRoute.POST(
      request('/x', { method: 'POST', body: { type: 'taxonomy_sync' } }),
      params({ jobId: (await syncJob()).id })
    )
  })

  it('records a sync that Taxomind cancelled as failed', async () => {
    signInAs(admin)
    statusReply = () => ({ body: { status: 'canceled' } })

    expect((await sync()).status).toBe(200)

    await expect.poll(async () => (await syncJob()).status).toBe('failed')
    expect((await syncJob()).errorMessage).toBe('External AI job was cancelled in the AI service')
  })

  it("resumes an orphaned sync job's polling without sending the taxonomy again", async () => {
    started.push({ resource: 'taxonomies', body: {}, polls: 0 })
    statusReply = () => ({ body: { status: 'completed' } })
    const job = await inWorkspace(() =>
      db().aITaxonomySyncJob.create({
        data: {
          workspaceId: wsId(),
          taxonomyId: taxonomy.id,
          connectionVersionId: connection.id,
          status: 'processing',
          externalJobId: 'ext-1',
          leaseOwner: 'dead-instance',
          leaseExpiresAt: new Date(Date.now() - 1000)
        }
      })
    )

    await monitor.ensureJobsMonitored()

    await expect
      .poll(async () => (await prisma.aITaxonomySyncJob.findUniqueOrThrow({ where: { id: job.id } })).status)
      .toBe('completed')
    expect(started).toHaveLength(1)
  })

  it('cancels a sync job and asks Taxomind to cancel it with the job connection', async () => {
    signInAs(admin)
    statusReply = () => ({ body: { status: 'running' } })
    expect((await sync()).status).toBe(200)
    await expect.poll(async () => (await syncJob()).externalJobId).toBe('ext-1')

    const res = await cancelRoute.POST(
      request('/x', { method: 'POST', body: { type: 'taxonomy_sync' } }),
      params({ jobId: (await syncJob()).id })
    )
    expect(await res.json()).toEqual({ ok: true, status: 'cancelled' })
    await expect.poll(() => cancels).toEqual(['/taxonomies/ext-1/cancel'])
  })

  it('cancels jobs on Taxomind best-effort', async () => {
    const client = ai.taxomindClient({ baseUrl: stubUrl, credential: 'stub-key' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await client.cancelJob('label', 'ext-404') // unknown job: 404, logged, not thrown
    expect(String(warn.mock.calls[0]?.[1])).toContain('AI labeling API error (404)')
    warn.mockRestore()
    started.push({ resource: 'taxonomies', body: {}, polls: 0 })
    await client.cancelJob('taxonomies', 'ext-1')
    expect(authHeaders).toHaveLength(2)
  })
})

describe('workspace connections', () => {
  const startLabeling = (sentenceIds: string[]) =>
    labelRoute.POST(request('/x', { method: 'POST', body: { taxonomyKey: 'ISCO', sentenceIds } }), params())

  it('starts no job without a usable connection, and says why', async () => {
    const [a] = await createSentences(1)
    signInAs(admin)

    await prisma.workspace.update({ where: { id: wsId() }, data: { aiEnabled: false } })
    let res = await startLabeling([a.id])
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('disabled')

    await prisma.workspace.update({ where: { id: wsId() }, data: { aiEnabled: true } })
    await prisma.aIConnectionVersion.updateMany({ data: { retiredAt: new Date() } })
    res = await startLabeling([a.id])
    expect((await res.json()).code).toBe('no_connection')
    expect(await prisma.aILabelingJob.count()).toBe(0)
  })

  it('queues one job per batch with its input records and runs it with the connection', async () => {
    const [a, b] = await createSentences(2)
    statusReply = completedWith([{ sentenceId: b.id, annotations: [{ level: 1, nodeCode: '02', confidence: 0.4 }] }])
    signInAs(admin)

    const res = await startLabeling([b.id, a.id])
    expect(res.status).toBe(200)
    const job = await prisma.aILabelingJob.findFirstOrThrow()
    expect(job.connectionVersionId).toBe(connection.id)
    const inputs = await prisma.aILabelingJobInput.findMany({ where: { jobId: job.id }, orderBy: { position: 'asc' } })
    expect(inputs.map(i => i.sentenceId).sort()).toEqual([a.id, b.id].sort())

    expect((await settle(job.id)).status).toBe('completed')
    expect(await storedSuggestions()).toEqual([[b.id, 1, '02', 0.4]])
  })

  it('keeps a job on the connection version it started with', async () => {
    const [a] = await createSentences(1)
    let release = false
    statusReply = job => (release ? completedWith([])(job) : { body: { status: 'running' } })
    const job = await labelingJob([a.id])
    await run()
    await settle(job.id, () => started.length === 1)

    // A new version with another credential: new jobs use it, this one does not.
    const next = await createAIConnection({ baseUrl: stubUrl, credential: 'rotated-key' })
    allowedAuth.add('Bearer rotated-key')
    release = true

    expect((await settle(job.id)).status).toBe('completed')
    expect(next.version).toBe(connection.version + 1)
    expect(authHeaders.every(h => h === 'Bearer stub-key')).toBe(true)
  })

  it('cancels queued and running jobs when the workspace is archived, and asks Taxomind to cancel', async () => {
    const [a, b] = await createSentences(2)
    statusReply = () => ({ body: { status: 'running' } })
    const running = await labelingJob([a.id])
    await run()
    await settle(running.id, () => started.length === 1)
    const queued = await labelingJob([b.id]) // not admitted: nothing schedules it
    signInAs(admin)

    const res = await workspaceRoute.PUT(request('/x', { method: 'PUT', body: { status: 'archived' } }), params())
    expect(res.status).toBe(200)

    for (const id of [running.id, queued.id]) {
      expect(await prisma.aILabelingJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'cancelled',
        errorMessage: 'Workspace archived'
      })
    }
    await expect.poll(() => cancels).toEqual(['/label/ext-1/cancel'])
    const archived = await prisma.auditLog.findFirstOrThrow({ where: { action: 'workspace.archived' } })
    expect(archived.payload).toMatchObject({ cancelledJobs: 2 })
  })
})

describe('poll backoff', () => {
  it('doubles the interval per failed request, capped', () => {
    expect(monitor.pollDelay(0)).toBe(20)
    expect(monitor.pollDelay(3)).toBe(160)
    expect(monitor.pollDelay(40)).toBe(5 * 60_000)
  })
})
