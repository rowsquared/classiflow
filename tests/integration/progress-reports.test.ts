import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sentence, User } from '@/lib/generated/prisma/client'
import {
  prisma,
  createWorkspace,
  createSentences,
  createTaxonomy,
  createUser,
  params,
  request,
  resetDatabase,
  selectWorkspace,
  signInAs,
  wsId
} from './helpers'

// Count the application's SQL statements: the reports must run a fixed number
// of queries whatever the team size. The app client is replaced by one that
// emits query events (same runtime-role connection as setup.ts gives it).
const queries = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/prisma', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/prisma')>()
  const { PrismaClient } = await import('@/lib/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }),
    log: [{ emit: 'event', level: 'query' }]
  })
  client.$on('query', () => {
    queries.count++
  })
  return { ...original, prisma: client }
})

import * as annotationsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/annotations/route'
import * as bulkRoute from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'
import * as overviewRoute from '@/app/api/workspaces/[workspaceId]/progress/overview/route'
import * as activityRoute from '@/app/api/workspaces/[workspaceId]/progress/activity/route'
import * as peopleRoute from '@/app/api/workspaces/[workspaceId]/progress/people/route'
import * as membersRoute from '@/app/api/workspaces/[workspaceId]/progress/members/route'

// Team tree in the main workspace:
//   admin
//   sup (supervisor) -> l1 (labeller)
//                    -> sub (supervisor) -> l2 (labeller)
//   l3 (labeller, nobody's team)
// Records: r1, r2 -> l1; r3 -> l2; r4 -> l1 AND l2 (shared); r5 -> l3; r6 unassigned.
let admin: User, sup: User, sub: User, l1: User, l2: User, l3: User
let r1: Sentence, r2: Sentence, r3: Sentence, r4: Sentence, r5: Sentence

const label = (code = '02') => [{ level: 1, nodeCode: code, taxonomyKey: 'A' }]
const save = (sentenceId: string, body: Record<string, unknown>) =>
  annotationsRoute.POST(
    request(`/x/${sentenceId}/annotations`, { method: 'POST', body: { status: 'submitted', ...body } }),
    params({ sentenceId })
  )
const bulk = (body: Record<string, unknown>) =>
  bulkRoute.POST(request('/x/bulk-label', { method: 'POST', body: { taxonomyKey: 'A', ...body } }), params())

const range = 'startDate=2000-01-01&endDate=2001-12-31'
const wide = () => {
  // A two-year window ending today (UTC), so fresh activity is inside it.
  const end = new Date()
  const start = new Date(end.getTime() - 700 * 86_400_000)
  return `startDate=${start.toISOString().slice(0, 10)}&endDate=${end.toISOString().slice(0, 10)}`
}
async function overview(query = '') {
  const res = await overviewRoute.GET(request(`/x/overview?${wide()}&${query}`), params())
  return { status: res.status, body: await res.json() }
}
async function people(query = '') {
  const res = await peopleRoute.GET(request(`/x/people?${wide()}&${query}`), params())
  return { status: res.status, body: await res.json() }
}
const labeledBy = (body: { people: Array<{ userId: string; labeledRecords: number }> }, user: User) =>
  body.people.find(p => p.userId === user.id)?.labeledRecords

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  admin = await createUser('admin')
  sup = await createUser('supervisor')
  l1 = await createUser('labeller', { supervisorId: sup.id })
  sub = await createUser('supervisor', { supervisorId: sup.id })
  l2 = await createUser('labeller', { supervisorId: sub.id })
  l3 = await createUser('labeller')
  await createTaxonomy('A')
  ;[r1, r2] = await createSentences(2, [l1.id])
  ;[r3] = await createSentences(1, [l2.id])
  ;[r4] = await createSentences(1, [l1.id, l2.id])
  ;[r5] = await createSentences(1, [l3.id])
  await createSentences(1) // unassigned
})

describe('labeling activity', () => {
  it('records one event per labeled record for single and bulk saves', async () => {
    signInAs(l1)
    expect((await save(r1.id, { annotations: label() })).status).toBe(200)
    signInAs(l2)
    expect((await bulk({ sentenceIds: [r3.id, r4.id], annotations: [{ level: 1, nodeCode: '02' }] })).status).toBe(200)
    const events = await prisma.labelingActivity.findMany({ orderBy: { sentenceId: 'asc' } })
    expect(events).toHaveLength(3)
    expect(events.map(e => e.actorId).sort()).toEqual([l1.id, l2.id, l2.id].sort())
    const bulkEvents = events.filter(e => e.actorId === l2.id)
    expect(new Set(bulkEvents.map(e => e.operationId)).size).toBe(1)
    expect(events.every(e => e.workspaceId === wsId())).toBe(true)
  })

  it('records nothing for flag-, comment- and skip-only saves', async () => {
    signInAs(l1)
    await save(r1.id, { annotations: [], flagged: true })
    await save(r1.id, { annotations: [], comment: 'look at this' })
    await save(r2.id, { annotations: [], status: 'skipped' })
    await bulk({ sentenceIds: [r1.id, r2.id], flagged: true })
    expect(await prisma.labelingActivity.count()).toBe(0)
  })

  it('counts a re-save of the same code again, but a replayed operation once', async () => {
    signInAs(l1)
    await save(r1.id, { annotations: label() })
    await save(r1.id, { annotations: label() })
    expect(await prisma.labelingActivity.count()).toBe(2)

    const operationId = crypto.randomUUID()
    await save(r2.id, { annotations: label(), operationId })
    await save(r2.id, { annotations: label(), operationId })
    await bulk({
      sentenceIds: [r1.id, r4.id],
      annotations: [{ level: 1, nodeCode: '02' }],
      operationId: crypto.randomUUID()
    })
    const replay = crypto.randomUUID()
    await bulk({ sentenceIds: [r1.id, r4.id], annotations: [{ level: 1, nodeCode: '02' }], operationId: replay })
    await bulk({ sentenceIds: [r1.id, r4.id], annotations: [{ level: 1, nodeCode: '02' }], operationId: replay })
    expect(await prisma.labelingActivity.count({ where: { sentenceId: r2.id } })).toBe(1)
    expect(await prisma.labelingActivity.count({ where: { operationId: replay } })).toBe(2)
    expect((await save(r1.id, { annotations: label(), operationId: 'not-a-uuid' })).status).toBe(400)
  })

  it('writes nothing when the save rolls back', async () => {
    // Make the record update at the end of the save fail, after labels and
    // activity were written in the same transaction.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_update() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_update BEFORE UPDATE ON "Sentence"
      FOR EACH ROW WHEN (OLD.id = '${r1.id}') EXECUTE FUNCTION test_fail_update()`)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      signInAs(l1)
      expect((await save(r1.id, { annotations: label() })).status).toBe(500)
      expect((await bulk({ sentenceIds: [r1.id, r2.id], annotations: [{ level: 1, nodeCode: '02' }] })).status).toBe(
        500
      )
    } finally {
      error.mockRestore()
      await prisma.$executeRawUnsafe('DROP TRIGGER test_fail_update ON "Sentence"')
      await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_update()')
    }
    expect(await prisma.labelingActivity.count()).toBe(0)
    expect(await prisma.sentenceAnnotation.count()).toBe(0)
  })

  it('is append-only, keeps history when the actor is deleted, goes with its record', async () => {
    signInAs(l3)
    await save(r5.id, { annotations: label() })
    const [event] = await prisma.labelingActivity.findMany()
    await expect(
      prisma.labelingActivity.update({ where: { id: event!.id }, data: { createdAt: new Date(0) } })
    ).rejects.toThrow(/append-only/)
    await prisma.session.deleteMany({ where: { userId: l3.id } })
    await prisma.sentenceAssignment.deleteMany({ where: { sentenceId: r5.id } })
    await prisma.workspaceMembership.deleteMany({ where: { userId: l3.id } })
    await prisma.sentenceAnnotation.updateMany({ where: { createdById: l3.id }, data: { createdById: null } })
    await prisma.sentence.updateMany({ where: { lastEditorId: l3.id }, data: { lastEditorId: null } })
    await prisma.user.delete({ where: { id: l3.id } })
    expect((await prisma.labelingActivity.findUniqueOrThrow({ where: { id: event!.id } })).actorId).toBeNull()
    await prisma.sentenceAnnotation.deleteMany({ where: { sentenceId: r5.id } })
    await prisma.sentence.delete({ where: { id: r5.id } })
    expect(await prisma.labelingActivity.count()).toBe(0)
  })
})

describe('overview', () => {
  beforeEach(async () => {
    signInAs(l1)
    await save(r1.id, { annotations: label() })
    await save(r4.id, { annotations: label() })
    signInAs(l2)
    await bulk({ sentenceIds: [r3.id, r4.id], annotations: [{ level: 1, nodeCode: '02' }] })
  })

  it('admins see every record, unassigned included, and distinct labeled records', async () => {
    signInAs(admin)
    const { status, body } = await overview()
    expect(status).toBe(200)
    expect(body.workload).toMatchObject({ total: 6, complete: 3, remaining: 3, pending: 3, skipped: 0 })
    // r4 was labeled by two people: one record.
    expect(body.activity.labeledRecords).toBe(3)
    expect(body.projection).toMatchObject({
      completedInPeriod: 3,
      importedInPeriod: 6,
      status: 'no-net-progress',
      date: null
    })
    expect(body.timeZone).toBe('UTC')
    expect(body.activityCoverageStart).toEqual(expect.any(String))
  })

  it('AI suggestions alone neither complete records nor count as activity', async () => {
    const taxonomy = await prisma.taxonomy.findFirstOrThrow({ where: { workspaceId: wsId() } })
    await prisma.sentenceAISuggestion.create({
      data: {
        workspaceId: wsId(),
        sentenceId: r2.id,
        taxonomyId: taxonomy.id,
        level: 1,
        nodeCode: '02',
        confidenceScore: 0.9
      }
    })
    signInAs(admin)
    const { body } = await overview()
    expect(body.workload.complete).toBe(3)
    expect(body.activity.labeledRecords).toBe(3)
  })

  it('supervisors see their subtree without counting shared records twice', async () => {
    signInAs(sup)
    const { body } = await overview()
    expect(body.workload.total).toBe(4) // r1, r2, r3, r4
    expect(body.activity.labeledRecords).toBe(3)
    signInAs(sub)
    expect((await overview()).body.workload.total).toBe(2) // r3, r4
  })

  it('labellers see their own work', async () => {
    signInAs(l2)
    const { body } = await overview()
    expect(body.workload).toMatchObject({ total: 2, complete: 2 })
    expect(body.activity.labeledRecords).toBe(2)
  })

  it('a person filter narrows workload by assignment and activity by author', async () => {
    signInAs(admin)
    const { body } = await overview(`personId=${l1.id}`)
    expect(body.workload.total).toBe(3) // r1, r2, r4
    expect(body.activity.labeledRecords).toBe(2) // r1, r4
    expect(body.personId).toBe(l1.id)
  })

  it('reassignment is not authorship; the viewer still needs to see the record', async () => {
    await prisma.sentenceAssignment.deleteMany({ where: { sentenceId: r1.id } })
    signInAs(admin)
    expect((await overview(`personId=${l1.id}`)).body.activity.labeledRecords).toBe(2)
    signInAs(sup)
    expect((await overview(`personId=${l1.id}`)).body.activity.labeledRecords).toBe(1)
  })

  it('team and person filters intersect', async () => {
    signInAs(admin)
    expect((await overview(`teamId=${sub.id}`)).body.workload.total).toBe(2)
    expect((await overview(`teamId=${sub.id}&personId=${l2.id}`)).body.workload.total).toBe(2)
    const disjoint = await overview(`teamId=${sub.id}&personId=${l1.id}`)
    expect(disjoint.status).toBe(200)
    expect(disjoint.body.workload.total).toBe(0)
    expect(disjoint.body.activity.labeledRecords).toBe(0)
  })

  it('refuses selectors outside the caller scope instead of widening it', async () => {
    signInAs(sup)
    expect((await overview(`personId=${l3.id}`)).status).toBe(403)
    expect((await overview(`personId=${admin.id}`)).status).toBe(403)
    signInAs(sub)
    expect((await overview(`teamId=${sup.id}`)).status).toBe(403)
    expect((await overview(`personId=${l1.id}`)).status).toBe(403)
    signInAs(l1)
    expect((await overview(`personId=${l2.id}`)).status).toBe(403)
    expect((await overview(`teamId=${sup.id}`)).status).toBe(403)
    expect((await overview(`personId=${l1.id}`)).status).toBe(200)
    signInAs(admin)
    expect((await overview('personId=nobody')).status).toBe(403)
  })

  it('refuses bad ranges', async () => {
    signInAs(admin)
    const bad = async (q: string) => (await overviewRoute.GET(request(`/x/overview?${q}`), params())).status
    expect(await bad('startDate=2026-10-08&endDate=2026-10-01')).toBe(400)
    expect(await bad('startDate=2020-01-01&endDate=2026-10-01')).toBe(400)
    expect(await bad('startDate=01.10.2026')).toBe(400)
    expect(await bad('')).toBe(200)
  })
})

describe('activity timeline', () => {
  it('buckets distinct records per UTC day and Monday week, gaps filled', async () => {
    const taxonomy = await prisma.taxonomy.findFirstOrThrow({ where: { workspaceId: wsId() } })
    const event = (sentence: Sentence, actor: User, at: string) => ({
      workspaceId: wsId(),
      sentenceId: sentence.id,
      taxonomyId: taxonomy.id,
      actorId: actor.id,
      operationId: crypto.randomUUID(),
      createdAt: new Date(at)
    })
    await prisma.labelingActivity.createMany({
      data: [
        event(r1, l1, '2026-10-23T21:30:00Z'),
        event(r1, l1, '2026-10-24T22:30:00Z'),
        event(r1, l1, '2026-10-25T10:00:00Z'), // Same record on another day
        event(r4, l2, '2026-10-25T22:30:00Z'),
        event(r3, l2, '2026-10-26T00:30:00Z'),
        event(r2, l1, '2026-11-02T12:00:00Z') // outside the range
      ]
    })
    signInAs(admin)
    const daily = await activityRoute.GET(
      request('/x/activity?startDate=2026-10-22&endDate=2026-10-27&granularity=day'),
      params()
    )
    const day = await daily.json()
    expect(day.timeZone).toBe('UTC')
    expect(day.buckets.map((b: { key: string; labeledRecords: number }) => [b.key, b.labeledRecords])).toEqual([
      ['2026-10-22', 0],
      ['2026-10-23', 1],
      ['2026-10-24', 1],
      ['2026-10-25', 2],
      ['2026-10-26', 1],
      ['2026-10-27', 0]
    ])
    const weekly = await (
      await activityRoute.GET(request('/x/activity?startDate=2026-10-22&endDate=2026-10-27&granularity=week'), params())
    ).json()
    expect(weekly.buckets).toEqual([
      { key: '2026-10-19', start: '2026-10-22', end: '2026-10-25', labeledRecords: 2 },
      { key: '2026-10-26', start: '2026-10-26', end: '2026-10-27', labeledRecords: 1 }
    ])
    signInAs(l2)
    const own = await (
      await activityRoute.GET(request('/x/activity?startDate=2026-10-22&endDate=2026-10-27&granularity=week'), params())
    ).json()
    expect(own.buckets.map((b: { labeledRecords: number }) => b.labeledRecords)).toEqual([1, 1])
    signInAs(admin)
    const tooLong = await activityRoute.GET(
      request('/x/activity?startDate=2025-01-01&endDate=2026-06-01&granularity=day'),
      params()
    )
    expect(tooLong.status).toBe(400)
    const badGranularity = await activityRoute.GET(request(`/x/activity?${range}&granularity=month`), params())
    expect(badGranularity.status).toBe(400)
  })
})

describe('people', () => {
  beforeEach(async () => {
    signInAs(l1)
    await save(r1.id, { annotations: label() })
    await save(r4.id, { annotations: label() })
    signInAs(l2)
    await bulk({ sentenceIds: [r3.id, r4.id], annotations: [{ level: 1, nodeCode: '02' }] })
  })

  it('lists workload by assignment and activity by actor, sorted and paged', async () => {
    signInAs(admin)
    const { body } = await people('sort=assigned&dir=desc')
    expect(body.total).toBe(6)
    expect(body.people[0]).toMatchObject({ userId: l1.id, assigned: 3, complete: 2, remaining: 1, labeledRecords: 2 })
    expect(labeledBy(body, l2)).toBe(2)
    expect(labeledBy(body, admin)).toBe(0)
    const page = await people('sort=name&pageSize=4&page=2')
    expect(page.body.people).toHaveLength(2)
    expect(page.body.total).toBe(6)
    const past = await people('pageSize=4&page=3')
    expect(past.body).toMatchObject({ people: [], total: 6 })
    expect((await people('pageSize=101')).status).toBe(400)
    expect((await people('sort=email')).status).toBe(400)
  })

  it('searches names, supervisors see only their subtree, labellers get no directory', async () => {
    signInAs(admin)
    const found = await people(`q=${encodeURIComponent(l2.username)}`)
    expect(found.body.people.map((p: { userId: string }) => p.userId)).toEqual([l2.id])
    expect((await people('q=%25')).body.total).toBe(0)
    signInAs(sup)
    const team = await people()
    expect(team.body.people.map((p: { userId: string }) => p.userId).sort()).toEqual(
      [sup.id, l1.id, sub.id, l2.id].sort()
    )
    signInAs(l1)
    expect((await people()).status).toBe(403)
  })

  it('lists platform admins who labeled here without a membership, for unrestricted views only', async () => {
    const platform = await prisma.user.create({
      data: {
        username: `platform-${Date.now()}`,
        email: `platform-${Date.now()}@test.local`,
        name: 'Platform Person',
        role: 'admin',
        mustResetPassword: false,
        sessions: { create: { token: `token-${Date.now()}`, expiresAt: new Date(Date.now() + 3600_000) } }
      }
    })
    signInAs(platform)
    expect((await save(r5.id, { annotations: label() })).status).toBe(200)

    signInAs(admin)
    const { body } = await people()
    expect(body.total).toBe(7)
    expect(body.people.find((p: { userId: string }) => p.userId === platform.id)).toMatchObject({
      platformOnly: true,
      role: 'admin',
      assigned: 0,
      labeledRecords: 1
    })
    expect(body.people.find((p: { userId: string }) => p.userId === l1.id)).toMatchObject({ platformOnly: false })
    expect((await people('q=Platform%20Person')).body.people).toHaveLength(1)
    // A team or person view lists members of that scope only.
    expect(
      (await people(`teamId=${sup.id}`)).body.people.some((p: { userId: string }) => p.userId === platform.id)
    ).toBe(false)
  })

  it('shows suspended members with their history', async () => {
    await prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: wsId(), userId: l1.id } },
      data: { status: 'suspended' }
    })
    signInAs(admin)
    const { body } = await people()
    expect(body.people.find((p: { userId: string }) => p.userId === l1.id)).toMatchObject({
      status: 'suspended',
      labeledRecords: 2
    })
  })
})

describe('picker search', () => {
  async function members(query = '') {
    const res = await membersRoute.GET(request(`/x/members?${query}`), params())
    return { status: res.status, body: await res.json() }
  }
  const ids = (body: { members: Array<{ userId: string }> }) => body.members.map(m => m.userId).sort()

  it('finds people the viewer may see, by name, limited, with a hint that there are more', async () => {
    signInAs(admin)
    expect(ids((await members()).body)).toEqual([admin.id, sup.id, l1.id, sub.id, l2.id, l3.id].sort())
    const limited = await members('limit=2')
    expect(limited.body.members).toHaveLength(2)
    expect(limited.body.more).toBe(true)
    expect(ids((await members(`q=${encodeURIComponent(l3.username)}`)).body)).toEqual([l3.id])
    expect(ids((await members('kind=team')).body)).toEqual([admin.id, sup.id, sub.id].sort())
    expect(ids((await members(`teamId=${sub.id}`)).body)).toEqual([sub.id, l2.id].sort())
    expect(ids((await members(`teamId=${sub.id}&userId=${l1.id}`)).body)).toEqual([])
    expect(Object.keys((await members('limit=1')).body.members[0]).sort()).toEqual(
      ['name', 'role', 'status', 'userId', 'username'].sort()
    )
  })

  it('stays inside the viewer scope', async () => {
    signInAs(sup)
    expect(ids((await members()).body)).toEqual([sup.id, l1.id, sub.id, l2.id].sort())
    expect(ids((await members(`userId=${l3.id}`)).body)).toEqual([])
    expect((await members(`teamId=${l3.id}`)).status).toBe(403)
    signInAs(l1)
    expect((await members()).status).toBe(403)
  })
})

describe('counts reconcile with the fixture', () => {
  it('overview, timeline and people agree with what was assigned and saved', async () => {
    // Twelve more records: l1, l2, both, l3 in turn.
    const owners: User[][] = [[l1], [l2], [l1, l2], [l3]]
    const extra: Array<{ id: string; owners: User[] }> = []
    for (let i = 0; i < 12; i++) {
      const who = owners[i % 4]!
      const [record] = await createSentences(
        1,
        who.map(u => u.id)
      )
      extra.push({ id: record!.id, owners: who })
    }
    const all = [
      { id: r1.id, owners: [l1] },
      { id: r2.id, owners: [l1] },
      { id: r3.id, owners: [l2] },
      { id: r4.id, owners: [l1, l2] },
      { id: r5.id, owners: [l3] },
      ...extra
    ]
    // The truth, kept while saving: who saved which record, which are complete.
    const savedBy = new Map<string, Set<string>>()
    const complete = new Set<string>()
    const record = async (actor: User, id: string, times = 1) => {
      signInAs(actor)
      for (let t = 0; t < times; t++) expect((await save(id, { annotations: label() })).status).toBe(200)
      savedBy.set(actor.id, (savedBy.get(actor.id) ?? new Set()).add(id))
      complete.add(id)
    }
    for (const [i, r] of all.entries()) {
      if (i % 3 === 0) await record(r.owners[0]!, r.id, i % 2 ? 2 : 1) // a repeated save counts once
      if (i % 5 === 0) await record(r.owners.at(-1)!, r.id)
      if (i % 7 === 0) await record(admin, r.id)
    }
    signInAs(l2)
    const bulkIds = all.filter(r => r.owners.includes(l2) && !complete.has(r.id)).map(r => r.id)
    expect((await bulk({ sentenceIds: bulkIds, annotations: [{ level: 1, nodeCode: '02' }] })).status).toBe(200)
    for (const id of bulkIds) {
      savedBy.set(l2.id, (savedBy.get(l2.id) ?? new Set()).add(id))
      complete.add(id)
    }

    const union = (sets: Array<Set<string> | undefined>) => new Set(sets.flatMap(set => [...(set ?? [])]))
    const assignedTo = (users: User[]) => all.filter(r => r.owners.some(o => users.some(u => u.id === o.id)))

    // Admin: every record (one unassigned) and anyone's activity.
    signInAs(admin)
    const adminView = (await overview()).body
    expect(adminView.workload).toMatchObject({
      total: all.length + 1,
      complete: complete.size,
      remaining: all.length + 1 - complete.size
    })
    expect(adminView.activity.labeledRecords).toBe(union([...savedBy.values()]).size)
    const timeline = await activityRoute.GET(request(`/x/activity?${wide()}&granularity=week`), params())
    const buckets: Array<{ labeledRecords: number }> = (await timeline.json()).buckets
    // Everything happened today, so one bucket holds it all.
    expect(buckets.reduce((sum, b) => sum + b.labeledRecords, 0)).toBe(adminView.activity.labeledRecords)

    const rows = (await people('pageSize=100')).body.people as Array<{
      userId: string
      assigned: number
      complete: number
      remaining: number
      labeledRecords: number
    }>
    for (const person of [l1, l2, l3, sup, sub, admin]) {
      const mine = assignedTo([person])
      const row = rows.find(r => r.userId === person.id)!
      expect(row, person.username).toMatchObject({
        assigned: mine.length,
        complete: mine.filter(r => complete.has(r.id)).length,
        remaining: mine.filter(r => !complete.has(r.id)).length,
        labeledRecords: savedBy.get(person.id)?.size ?? 0
      })
    }

    // Supervisor: records of the subtree; activity by the subtree, in those records.
    signInAs(sup)
    const team = assignedTo([l1, l2])
    const teamIds = new Set(team.map(r => r.id))
    const supView = (await overview()).body
    expect(supView.workload).toMatchObject({
      total: team.length,
      complete: team.filter(r => complete.has(r.id)).length
    })
    const teamActivity = [...union([savedBy.get(l1.id), savedBy.get(l2.id)])].filter(id => teamIds.has(id))
    expect(supView.activity.labeledRecords).toBe(teamActivity.length)
  })
})

describe('isolation and query count', () => {
  it('reports only this workspace, even for people in both', async () => {
    signInAs(l1)
    await save(r1.id, { annotations: label() })
    const first = wsId()
    await createWorkspace()
    await prisma.workspaceMembership.create({ data: { workspaceId: wsId(), userId: l1.id, role: 'labeller' } })
    const otherAdmin = await createUser('admin')
    await createTaxonomy('A')
    const [x] = await createSentences(1, [l1.id])
    signInAs(l1)
    await save(x.id, { annotations: label() })
    signInAs(otherAdmin)
    const { body } = await overview(`personId=${l1.id}`)
    expect(body.workload.total).toBe(1)
    expect(body.activity.labeledRecords).toBe(1)
    expect((await overview(`personId=${l2.id}`)).status).toBe(403) // a member elsewhere only
    selectWorkspace(first)
    signInAs(admin)
    expect((await overview()).body.activity.labeledRecords).toBe(1)
  })

  it('runs the same number of queries for 4 or 40 team members', async () => {
    const countFor = async (run: () => Promise<Response>) => {
      queries.count = 0
      const res = await run()
      expect(res.status).toBe(200)
      return queries.count
    }
    const runAll = async () => {
      signInAs(sup)
      return [
        await countFor(() => overviewRoute.GET(request(`/x/overview?${wide()}`), params())),
        await countFor(() => overviewRoute.GET(request(`/x/overview?${wide()}&teamId=${sub.id}`), params())),
        await countFor(() => activityRoute.GET(request(`/x/activity?${wide()}&granularity=week`), params())),
        await countFor(() => peopleRoute.GET(request(`/x/people?${wide()}`), params()))
      ]
    }
    const small = await runAll()
    expect(small[0]).toBeGreaterThan(0)
    for (let i = 0; i < 36; i++) {
      const labeller = await createUser('labeller', { supervisorId: i % 2 ? sub.id : sup.id })
      await createSentences(2, [labeller.id])
    }
    expect(await runAll()).toEqual(small)
  })
})
