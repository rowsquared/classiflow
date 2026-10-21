import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Workspace } from '@/lib/generated/prisma/client'
import { prisma as app } from '@/lib/prisma'
import { credentialAad, decryptCredential, deploymentKeyring } from '@/lib/ai-credentials'
import {
  createAIConnection,
  createTaxonomy,
  createUser,
  createWorkspace,
  params,
  plainParams,
  prisma,
  request,
  resetDatabase,
  selectWorkspace,
  signInAs,
  wsId
} from './helpers'

import * as endpointsRoute from '@/app/api/ai-endpoints/route'
import * as endpointRoute from '@/app/api/ai-endpoints/[endpointId]/route'
import * as settingsRoute from '@/app/api/workspaces/[workspaceId]/ai-settings/route'
import * as connectionRoute from '@/app/api/workspaces/[workspaceId]/ai-settings/connection/route'

// Per-workspace AI connections: approved endpoints (platform), connection
// versions with write-only encrypted credentials (workspace admins), and the
// cross-workspace job functions for admission and lease release, called as the
// runtime role the application uses.
vi.hoisted(() => {
  process.env.AI_SOURCE_SLUG = 'stub-deployment'
  process.env.AI_CREDENTIALS_KEYS = 'k2026:W2yqrU25xVWcv6H1lvt11YmB5W8aFNzjyXGwGQJpp1Q='
})

const SECRET = 'taxomind-secret-token-0123'

let ws: Workspace
let platform: User, admin: User, supervisor: User

beforeEach(async () => {
  await resetDatabase()
  ws = await createWorkspace()
  admin = await createUser('admin')
  supervisor = await createUser('supervisor')
  platform = await createUser('labeller', { platformAdmin: true })
})

const approve = (body: unknown) => endpointsRoute.POST(request('/api/ai-endpoints', { method: 'POST', body }))
const connect = (body: unknown) => connectionRoute.POST(request('/x', { method: 'POST', body }), params())
const settings = async () => (await settingsRoute.GET(request('/x'), params())).json()

async function approvedEndpoint(baseUrl = 'https://taxomind.example.org/api') {
  signInAs(platform)
  const res = await approve({ name: 'Taxomind', baseUrl })
  expect(res.status).toBe(201)
  return (await res.json()).endpoint as { id: string; baseUrl: string }
}

describe('approved endpoints', () => {
  it('are managed by platform admins only', async () => {
    signInAs(admin)
    expect((await endpointsRoute.GET()).status).toBe(403)
    expect((await approve({ name: 'x', baseUrl: 'https://x.example.org' })).status).toBe(403)
  })

  it('store a canonical URL and refuse URLs that carry credentials or other schemes', async () => {
    const endpoint = await approvedEndpoint('https://Taxomind.Example.org/api/')
    expect(endpoint.baseUrl).toBe('https://taxomind.example.org/api')
    for (const baseUrl of ['https://user:pw@x.example.org', 'ftp://x.example.org', 'https://x.example.org/?a=1', 'x']) {
      expect((await approve({ name: 'bad', baseUrl })).status).toBe(400)
    }
  })

  it('can be retired; a retired endpoint takes no new connection', async () => {
    const endpoint = await approvedEndpoint()
    expect((await endpointRoute.DELETE(request('/x'), plainParams({ endpointId: endpoint.id }))).status).toBe(200)
    expect((await endpointRoute.DELETE(request('/x'), plainParams({ endpointId: endpoint.id }))).status).toBe(404)
    signInAs(admin)
    expect((await connect({ endpointId: endpoint.id, credential: SECRET })).status).toBe(400)
    expect((await settings()).endpoints).toEqual([])
  })
})

describe('workspace connections', () => {
  it('are for workspace admins only', async () => {
    const endpoint = await approvedEndpoint()
    signInAs(supervisor)
    expect((await settingsRoute.GET(request('/x'), params())).status).toBe(403)
    expect((await connect({ endpointId: endpoint.id, credential: SECRET })).status).toBe(403)
  })

  it('keep the credential write-only and encrypted', async () => {
    const endpoint = await approvedEndpoint()
    signInAs(admin)

    const res = await connect({ endpointId: endpoint.id, credential: SECRET })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(body.active).toMatchObject({
      version: 1,
      namespace: `stub-deployment--${ws.id}`,
      credentialStored: true,
      endpoint: { id: endpoint.id }
    })
    expect(JSON.stringify(await settings())).not.toContain(SECRET)

    const row = await prisma.aIConnectionVersion.findFirstOrThrow()
    expect(row.credential).not.toContain(SECRET)
    expect(decryptCredential(row.credential!, credentialAad(ws.id, row.id), deploymentKeyring()!)).toBe(SECRET)

    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: 'ai.' } } })
    expect(audits.map(a => a.action).sort()).toEqual(['ai.connection_created', 'ai.endpoint_approved'])
    expect(JSON.stringify(audits)).not.toContain(SECRET)
  })

  it('never echoes a refused body', async () => {
    signInAs(admin)
    const res = await connect({ endpointId: 42, credential: SECRET })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain(SECRET)
  })

  it('are versioned: a new version retires the previous one and erases its unused credential', async () => {
    const endpoint = await approvedEndpoint()
    signInAs(admin)
    await connect({ endpointId: endpoint.id, credential: SECRET })
    // A running job keeps version 1's credential alive.
    const v1 = await prisma.aIConnectionVersion.findFirstOrThrow()
    const taxonomy = await createTaxonomy()
    const job = await prisma.aILabelingJob.create({
      data: {
        workspaceId: ws.id,
        createdById: admin.id,
        taxonomyId: taxonomy.id,
        connectionVersionId: v1.id,
        status: 'processing',
        totalSentences: 0
      }
    })

    const second = await (await connect({ endpointId: endpoint.id, credential: 'second-token' })).json()
    expect(second.active.version).toBe(2)
    expect(
      second.versions.map((v: { version: number; retiredAt: string | null }) => [v.version, !!v.retiredAt])
    ).toEqual([
      [2, false],
      [1, true]
    ])
    expect((await prisma.aIConnectionVersion.findUniqueOrThrow({ where: { id: v1.id } })).credential).not.toBeNull()

    await prisma.aILabelingJob.update({ where: { id: job.id }, data: { status: 'completed' } })
    await connect({ endpointId: endpoint.id, credential: 'third-token' })
    const versions = await prisma.aIConnectionVersion.findMany({ orderBy: { version: 'asc' } })
    expect(versions.map(v => v.credential === null)).toEqual([true, true, false])
  })

  it('turn AI on only with a usable connection, and off by removing it', async () => {
    signInAs(admin)
    const put = (enabled: boolean) => settingsRoute.PUT(request('/x', { method: 'PUT', body: { enabled } }), params())
    let res = await put(true)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('no_connection')

    const endpoint = await approvedEndpoint()
    signInAs(admin)
    await connect({ endpointId: endpoint.id, credential: SECRET })
    res = await put(true)
    expect(res.status).toBe(200)
    expect((await res.json()).enabled).toBe(true)

    const removed = await (await connectionRoute.DELETE(request('/x', { method: 'DELETE' }), params())).json()
    expect(removed).toMatchObject({ enabled: false, active: null })
  })

  it("are invisible to another workspace's admins", async () => {
    const endpoint = await approvedEndpoint()
    signInAs(admin)
    await connect({ endpointId: endpoint.id, credential: SECRET })

    await createWorkspace()
    const otherAdmin = await createUser('admin')
    signInAs(otherAdmin)
    const other = await settings()
    expect(other).toMatchObject({ active: null, versions: [], enabled: false })
    selectWorkspace(ws.id)
  })
})

// ---------------------------------------------------------------------------
// Admission and lease release (database functions, as the runtime role)
// ---------------------------------------------------------------------------

type Admitted = { kind: string; id: string; workspaceId: string }

const admit = (perWorkspace: number, deployment: number, owner = 'instance-a') =>
  app.$queryRaw<Admitted[]>`
    SELECT kind, id, "workspaceId" FROM app_admit_ai_jobs(${perWorkspace}::integer, ${deployment}::integer,
      ${owner}, ${new Date(Date.now() + 60_000).toISOString()}::timestamp)`

/** `count` queued labeling jobs in the current workspace, oldest first. */
async function queue(count: number, minutesAgo: number) {
  const workspaceId = wsId()
  const taxonomy = await prisma.taxonomy.findFirst({ where: { workspaceId } })
  const tax = taxonomy ?? (await createTaxonomy())
  const connection =
    (await prisma.aIConnectionVersion.findFirst({ where: { workspaceId, retiredAt: null } })) ??
    (await createAIConnection())
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const job = await prisma.aILabelingJob.create({
      data: {
        workspaceId,
        createdById: admin.id,
        taxonomyId: tax.id,
        connectionVersionId: connection.id,
        totalSentences: 0,
        startedAt: new Date(Date.now() - (minutesAgo - i) * 60_000)
      }
    })
    ids.push(job.id)
  }
  return ids
}

describe('job admission', () => {
  it('admits fairly across workspaces within the per-workspace and deployment ceilings', async () => {
    const a = await queue(3, 30) // oldest
    await createWorkspace()
    const b = await queue(2, 10)

    const first = await admit(2, 3)
    // Every workspace's first job before any second one, oldest first.
    expect(first.map(j => j.id)).toEqual([a[0], b[0], a[1]])
    expect(await prisma.aILabelingJob.count({ where: { status: 'processing', leaseOwner: 'instance-a' } })).toBe(3)

    expect(await admit(2, 3)).toEqual([]) // deployment ceiling reached
    expect((await admit(2, 10)).map(j => j.id)).toEqual([b[1]]) // A holds its 2
    await prisma.aILabelingJob.update({ where: { id: a[0] }, data: { status: 'completed' } })
    expect((await admit(2, 10)).map(j => j.id)).toEqual([a[2]])
  })

  it('holds the ceilings when instances admit at the same time', async () => {
    await queue(6, 30)
    await createWorkspace()
    await queue(6, 30)

    const results = await Promise.all([admit(3, 4, 'x'), admit(3, 4, 'y'), admit(3, 4, 'z')])
    const admitted = results.flat()
    expect(admitted).toHaveLength(4)
    expect(new Set(admitted.map(j => j.id)).size).toBe(4)
    const perWorkspace = await prisma.aILabelingJob.groupBy({
      by: ['workspaceId'],
      where: { status: 'processing' },
      _count: true
    })
    expect(perWorkspace.every(row => row._count <= 3)).toBe(true)
  })

  it('counts learning and sync jobs against the same ceilings', async () => {
    const taxonomy = await createTaxonomy()
    const connection = await createAIConnection()
    await prisma.aITaxonomySyncJob.create({
      data: { workspaceId: ws.id, taxonomyId: taxonomy.id, connectionVersionId: connection.id, status: 'processing' }
    })
    await prisma.aILearningJob.create({
      data: {
        workspaceId: ws.id,
        createdById: admin.id,
        taxonomyId: taxonomy.id,
        connectionVersionId: connection.id,
        totalSentences: 0
      }
    })
    await queue(1, 5)
    // The running sync takes one of the workspace's two slots: one more fits.
    const admitted = await admit(2, 10)
    expect(admitted.map(j => j.kind)).toEqual(['labeling'])
    expect(await prisma.aILearningJob.count({ where: { status: 'pending' } })).toBe(1)
  })
})

describe('lease release on shutdown', () => {
  it("gives back only the stopping instance's leases", async () => {
    const [mine, theirs] = await queue(2, 10)
    await admit(1, 10, 'stopping')
    await admit(1, 10, 'staying') // per-workspace 1: nothing more
    const until = new Date(Date.now() + 60_000)
    await prisma.aILabelingJob.update({
      where: { id: theirs },
      data: { status: 'processing', leaseOwner: 'staying', leaseExpiresAt: until }
    })

    const [row] = await app.$queryRaw<Array<{ released: number }>>`SELECT app_release_ai_leases('stopping') AS released`
    expect(row?.released).toBe(1)
    expect(await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: mine } })).toMatchObject({
      status: 'processing',
      leaseOwner: null,
      leaseExpiresAt: null
    })
    expect((await prisma.aILabelingJob.findUniqueOrThrow({ where: { id: theirs } })).leaseOwner).toBe('staying')
  })

  it('releaseAllLeases() stops this instance and frees its leases for recovery', async () => {
    const monitor = await import('@/lib/ai-job-monitor')
    const [id] = await queue(1, 10)
    await admit(1, 10, monitor.monitorInstanceId())

    expect(await monitor.releaseAllLeases()).toBe(1)
    expect((await prisma.aILabelingJob.findUniqueOrThrow({ where: { id } })).leaseOwner).toBeNull()
    // While stopping, nothing is admitted by this instance.
    await monitor.admitQueuedJobs()
    expect(await prisma.aILabelingJob.count({ where: { leaseOwner: monitor.monitorInstanceId() } })).toBe(0)
    monitor.resumeAfterRelease()
  })
})
