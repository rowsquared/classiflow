import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Taxonomy, User } from '@/lib/generated/prisma/client'
import openapi from '@/lib/contracts/taxomind.openapi.json'
import { db } from '@/lib/workspace/db'
import {
  prisma,
  wsId,
  inWorkspace,
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
// Poll fast; the modules read these at load time, so they are imported after
// the stub listens (beforeAll).
vi.hoisted(() => {
  process.env.AI_JOB_POLL_INTERVAL_MS = '20'
  process.env.AI_JOB_POLL_TIMEOUT_MS = '10000'
  process.env.AI_LABELING_API_KEY = 'stub-key'
  process.env.AI_SOURCE_SLUG = 'stub-deployment'
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
const started: StubJob[] = []
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
  process.env.AI_LABELING_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  monitor = await import('@/lib/ai-job-monitor')
  ai = await import('@/lib/ai-labeling')
  syncRoute = await import('@/app/api/workspaces/[workspaceId]/taxonomies/[key]/sync-ai/route')
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

let admin: User
let taxonomy: Taxonomy

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  await createWorkspace()
  await createWorkspace()
  started.length = 0
  authHeaders = []
  violations = []
  createdReply = undefined
  admin = await createUser('admin')
  taxonomy = await createTaxonomy('ISCO')
})

afterEach(() => {
  expect(violations).toEqual([])
  expect(authHeaders.every(h => h === 'Bearer stub-key')).toBe(true)
})

const ACTIVE = ['pending', 'processing']

async function labelingJob(sentenceIds: string[], extra: Record<string, unknown> = {}) {
  return inWorkspace(() =>
    db().aILabelingJob.create({
      data: {
        workspaceId: wsId(),
        createdById: admin.id,
        taxonomyId: taxonomy.id,
        totalSentences: sentenceIds.length,
        filterCriteria: { sentenceIds },
        ...extra
      }
    })
  )
}

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
    const [a, b] = await createSentences(2)
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
            { sentenceId: 'someone-else', annotations: [{ level: 1, nodeCode: '02', confidence: 0.5 }] } // foreign record
          ])(job)
    const job = await labelingJob([a.id, b.id])

    monitor.launchJob(job.id, wsId())
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.externalJobId).toBe('ext-1')
    expect(done.failedSentences).toBe(1)
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

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('model not trained')
  })

  it('marks the job failed when Taxomind cancelled it', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'canceled' } })
    const job = await labelingJob([a.id])

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.failedSentences).toBe(1)
    expect(await storedSuggestions()).toEqual([[a.id, 1, '01', 0.5]])
  })

  it('completes without suggestions when a completed job has no result', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'completed', result: null } })
    const job = await labelingJob([a.id])

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
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

    monitor.launchJob(job.id, wsId())
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('AI labeling API error (401): {"detail":"Invalid token"}')
  })

  it('leaves a job alone while another instance holds its lease', async () => {
    const [a] = await createSentences(1)
    statusReply = completedWith([])
    const job = await labelingJob([a.id], {
      leaseOwner: 'other-instance',
      leaseExpiresAt: new Date(Date.now() + 60_000)
    })

    monitor.launchJob(job.id, wsId())
    await new Promise(r => setTimeout(r, 200))

    expect(started).toHaveLength(0)
    const after = await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(after).toMatchObject({ status: 'pending', leaseOwner: 'other-instance' })
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
    const job = await inWorkspace(() =>
      db().aILearningJob.create({
        data: {
          workspaceId: wsId(),
          createdById: admin.id,
          taxonomyId: taxonomy.id,
          totalSentences: 1,
          filterCriteria: { sentenceIds: [a.id] }
        }
      })
    )

    monitor.launchLearningJob(job.id, wsId())
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
          annotations: expect.arrayContaining([
            { level: 1, nodeCode: '01' },
            { level: 2, nodeCode: '011' }
          ])
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
  const syncStatus = async () =>
    (await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxonomy.id } })).lastAISyncStatus

  it('sends the taxonomy as the contract describes it and records completion', async () => {
    signInAs(admin)
    statusReply = job => ({ body: job.polls < 2 ? { status: 'running' } : { status: 'completed', progress: 1 } })

    const res = await sync()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, jobId: 'ext-1' })

    await expect.poll(syncStatus).toBe('completed')
    const body = started[0]?.body as {
      action: string
      sourceSlug: string
      taxonomy: { key: string; nodes: Array<{ code: string }> }
    }
    expect(body).toMatchObject({
      action: 'create',
      sourceSlug: `stub-deployment--${wsId()}`,
      taxonomy: { key: 'ISCO' }
    })
    expect(body.taxonomy.nodes.map(n => n.code).sort()).toEqual(['01', '011', '012', '02'])
  })

  it('records a sync that Taxomind cancelled as failed', async () => {
    signInAs(admin)
    statusReply = () => ({ body: { status: 'canceled' } })

    expect((await sync()).status).toBe(200)

    await expect.poll(syncStatus).toBe('failed')
    expect((await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxonomy.id } })).lastAISyncError).toBe(
      'AI job was cancelled in the AI service'
    )
  })

  it('cancels jobs on Taxomind best-effort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ai.cancelAIJob('/label', 'ext-404') // unknown job: 404, logged, not thrown
    expect(String(warn.mock.calls[0]?.[1])).toContain('AI labeling API error (404)')
    warn.mockRestore()
    started.push({ resource: 'taxonomies', body: {}, polls: 0 })
    await ai.cancelAIJob('/taxonomies', 'ext-1')
    expect(authHeaders).toHaveLength(2)
  })
})

describe('poll backoff', () => {
  it('doubles the interval per failed request, capped', () => {
    expect(monitor.pollDelay(0)).toBe(20)
    expect(monitor.pollDelay(3)).toBe(160)
    expect(monitor.pollDelay(40)).toBe(5 * 60_000)
  })
})
