import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Taxonomy, User } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { createSentences, createTaxonomy, createUser, resetDatabase } from './helpers'

// The monitor against a stub Taxomind on a local port. Poll fast; the module
// reads these at load time, so lib/ai-job-monitor is imported after the stub
// listens (beforeAll).
vi.hoisted(() => {
  process.env.AI_JOB_POLL_INTERVAL_MS = '20'
  process.env.AI_JOB_POLL_TIMEOUT_MS = '10000'
  process.env.AI_LABELING_API_KEY = 'stub-key'
})

type StubJob = { path: string; body: Record<string, unknown>; polls: number }
type StatusReply = (job: StubJob) => { code?: number; body: unknown }

let server: Server
let monitor: typeof import('@/lib/ai-job-monitor')
const started: StubJob[] = []
let statusReply: StatusReply
let authHeaders: string[] = []

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  authHeaders.push(String(req.headers.authorization))
  let raw = ''
  for await (const chunk of req) raw += chunk
  const url = req.url || ''
  const start = url.match(/^\/(label|learn)$/)
  if (req.method === 'POST' && start) {
    started.push({ path: url, body: JSON.parse(raw || '{}'), polls: 0 })
    return send(res, 200, { job_id: `ext-${started.length}` })
  }
  const status = url.match(/^\/(label|learn)\/ext-(\d+)\/status$/)
  if (req.method === 'GET' && status) {
    const job = started[Number(status[2]) - 1]
    job.polls++
    const reply = statusReply(job)
    return send(res, reply.code ?? 200, reply.body)
  }
  if (req.method === 'POST' && url.endsWith('/cancel')) return send(res, 200, {})
  send(res, 404, { error: 'unknown route' })
}

beforeAll(async () => {
  server = createServer((req, res) => { handle(req, res).catch(() => send(res, 500, {})) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.AI_LABELING_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  monitor = await import('@/lib/ai-job-monitor')
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

let admin: User
let taxonomy: Taxonomy

beforeEach(async () => {
  await resetDatabase()
  started.length = 0
  authHeaders = []
  admin = await createUser('admin')
  taxonomy = await createTaxonomy('ISCO')
})

const ACTIVE = ['pending', 'processing']

async function labelingJob(sentenceIds: string[], extra: Record<string, unknown> = {}) {
  return prisma.aILabelingJob.create({
    data: {
      createdById: admin.id,
      taxonomyId: taxonomy.id,
      totalSentences: sentenceIds.length,
      filterCriteria: { sentenceIds },
      ...extra,
    },
  })
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

const completedWith = (suggestions: unknown) => () => ({ body: { status: 'completed', result: { suggestions } } })

describe('AI job monitor against a stub service', () => {
  it('sends the records, polls to completion and stores only valid suggestions', async () => {
    const [a, b] = await createSentences(2)
    statusReply = job => (job.polls < 3
      ? { body: { status: 'processing', progress: 0.5 } }
      : completedWith([
        { sentence_id: a.id, annotations: [{ level: 1, nodeCode: '01', confidence: 0.9 }, { level: 2, nodeCode: '011', confidence: 0.8 }] },
        { sentence_id: b.id, annotations: [{ level: 1, nodeCode: '99', confidence: 0.7 }] }, // not in the taxonomy
        { sentence_id: 'someone-else', annotations: [{ level: 1, nodeCode: '02' }] }, // foreign record
      ])())
    const job = await labelingJob([a.id, b.id])

    monitor.launchJob(job.id)
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(done.externalJobId).toBe('ext-1')
    expect(done.failedSentences).toBe(1)
    expect(done.leaseOwner).toBeNull()
    expect(started).toHaveLength(1)
    expect(started[0].body).toMatchObject({ taxonomyKey: 'ISCO', batchId: job.id })
    expect(started[0].body.sentences).toEqual([
      { sentence_id: a.id, fields: { text: 'record 0' } },
      { sentence_id: b.id, fields: { text: 'record 1' } },
    ])
    expect(authHeaders.every(h => h === 'Bearer stub-key')).toBe(true)
    const stored = await prisma.sentenceAISuggestion.findMany({ orderBy: [{ sentenceId: 'asc' }, { level: 'asc' }] })
    expect(stored.map(s => [s.sentenceId, s.level, s.nodeCode])).toEqual([[a.id, 1, '01'], [a.id, 2, '011']])
  })

  it('marks the job failed with the service error', async () => {
    const [a] = await createSentences(1)
    statusReply = () => ({ body: { status: 'failed', error: 'model not trained' } })
    const job = await labelingJob([a.id])

    monitor.launchJob(job.id)
    const done = await settle(job.id)

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toBe('model not trained')
  })

  it('keeps a job cancelled while polling cancelled and writes no suggestions', async () => {
    const [a] = await createSentences(1)
    let cancelled = false
    statusReply = () => (cancelled
      ? completedWith([{ sentence_id: a.id, annotations: [{ level: 1, nodeCode: '02' }] }])()
      : { body: { status: 'processing' } })
    const job = await labelingJob([a.id])

    monitor.launchJob(job.id)
    await settle(job.id, status => status === 'processing')
    await prisma.aILabelingJob.update({ where: { id: job.id }, data: { status: 'cancelled' } })
    cancelled = true
    await new Promise(r => setTimeout(r, 200))

    expect((await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('cancelled')
    expect(await prisma.sentenceAISuggestion.count()).toBe(0)
  })

  it('keeps polling through failed status requests', async () => {
    const [a] = await createSentences(1)
    statusReply = job => (job.polls <= 2
      ? { code: 503, body: { error: 'busy' } }
      : completedWith([{ sentence_id: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 1 }] }])())
    const job = await labelingJob([a.id])

    monitor.launchJob(job.id)
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(started[0].polls).toBe(3)
  })

  it('leaves a job alone while another instance holds its lease', async () => {
    const [a] = await createSentences(1)
    statusReply = completedWith([])
    const job = await labelingJob([a.id], {
      leaseOwner: 'other-instance',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    monitor.launchJob(job.id)
    await new Promise(r => setTimeout(r, 200))

    expect(started).toHaveLength(0)
    const after = await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(after).toMatchObject({ status: 'pending', leaseOwner: 'other-instance' })
  })

  it('takes over a dead instance\'s job and resumes polling without resending it', async () => {
    const [a] = await createSentences(1)
    // Another instance started the external job, then died: its lease expired.
    started.push({ path: '/label', body: {}, polls: 0 })
    statusReply = completedWith([{ sentence_id: a.id, annotations: [{ level: 1, nodeCode: '02', confidence: 0.5 }] }])
    const job = await labelingJob([a.id], {
      status: 'processing',
      externalJobId: 'ext-1',
      leaseOwner: 'dead-instance',
      leaseExpiresAt: new Date(Date.now() - 1000),
    })

    await monitor.ensureJobsMonitored()
    const done = await settle(job.id)

    expect(done.status).toBe('completed')
    expect(started).toHaveLength(1) // polled, not sent again
    expect(await prisma.sentenceAISuggestion.count()).toBe(1)
  })

  it('runs a learning job and records the taxonomy\'s last learning', async () => {
    const [a] = await createSentences(1)
    await prisma.sentenceAnnotation.create({
      data: { sentenceId: a.id, taxonomyId: taxonomy.id, level: 1, nodeCode: '02', source: 'user', createdById: admin.id },
    })
    statusReply = () => ({ body: { status: 'completed' } })
    const job = await prisma.aILearningJob.create({
      data: { createdById: admin.id, taxonomyId: taxonomy.id, totalSentences: 1, filterCriteria: { sentenceIds: [a.id] } },
    })

    monitor.launchLearningJob(job.id)
    for (let i = 0; i < 250; i++) {
      if ((await prisma.aILearningJob.findUniqueOrThrow({ where: { id: job.id } })).status === 'completed') break
      await new Promise(r => setTimeout(r, 20))
    }

    expect((await prisma.aILearningJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('completed')
    expect(started[0].path).toBe('/learn')
    expect(started[0].body.sentences).toEqual([
      { sentenceId: a.id, fields: { text: 'record 0' }, annotations: [{ level: 1, nodeCode: '02' }] },
    ])
    // Recorded right after the job's completion, outside its transaction.
    await expect.poll(async () => (await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxonomy.id } })).lastLearningStatus)
      .toBe('completed')
  })
})

describe('poll backoff', () => {
  it('doubles the interval per failed request, capped', () => {
    expect(monitor.pollDelay(0)).toBe(20)
    expect(monitor.pollDelay(3)).toBe(160)
    expect(monitor.pollDelay(40)).toBe(5 * 60_000)
  })
})
