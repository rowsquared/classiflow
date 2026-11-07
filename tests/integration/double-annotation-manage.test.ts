import { beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import {
  prisma,
  createWorkspace,
  createSentences,
  createTaxonomy,
  createUser,
  params,
  request,
  resetDatabase,
  signInAs
} from './helpers'

import * as annotationsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/annotations/route'
import * as startRoute from '@/app/api/workspaces/[workspaceId]/sentences/double-annotation/route'
import * as commandsRoute from '@/app/api/workspaces/[workspaceId]/sentences/double-annotation/commands/route'
import * as statsRoute from '@/app/api/workspaces/[workspaceId]/sentences/stats/route'
import * as listRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as overviewRoute from '@/app/api/workspaces/[workspaceId]/progress/overview/route'

// Managing double annotation (docs/plans/double-annotation-v2.md phase D):
// automatic second person, sampling, bulk commands, queue counts, progress.
let alice: User, bob: User, carol: User, sam: User

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  await createUser('admin')
  sam = await createUser('supervisor')
  alice = await createUser('labeller', { supervisorId: sam.id })
  bob = await createUser('labeller', { supervisorId: sam.id })
  carol = await createUser('labeller', { supervisorId: sam.id })
  await createTaxonomy('A')
})

const path = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode, taxonomyKey: 'A' }))
const save = (sentenceId: string, annotations: ReturnType<typeof path>) =>
  annotationsRoute.POST(
    request('/x', { method: 'POST', body: { annotations, status: 'submitted' } }),
    params({ sentenceId })
  )
const post = async (route: { POST: typeof startRoute.POST }, body: Record<string, unknown>) => {
  const res = await route.POST(request('/x', { method: 'POST', body }), params())
  return { status: res.status, body: await res.json() }
}
const start = async (body: Record<string, unknown>) => {
  const preview = await post(startRoute, { ...body, dryRun: true })
  expect(preview.status).toBe(200)
  const done = await post(startRoute, { ...body, expect: preview.body.counts })
  expect(done.status).toBe(200)
  return preview.body
}

describe('managing double annotation', () => {
  it('the automatic second person spreads the parts and never picks the first labeller', async () => {
    const records = await createSentences(6, [alice.id])
    signInAs(alice)
    for (const r of records) await save(r.id, path('01', '011'))

    signInAs(sam)
    const preview = await start({ sentenceIds: records.map(r => r.id), secondUserId: 'auto' })
    expect(preview.counts).toMatchObject({ labelled: 6, needs_first: 0 })
    const parts = Object.fromEntries(
      (preview.people as Array<{ userId: string; parts: number }>).map(p => [p.userId, p.parts])
    )
    expect(parts).toEqual({ [bob.id]: 3, [carol.id]: 3 })
    expect(await prisma.doubleTask.count({ where: { assigneeId: alice.id, fromBaseline: false } })).toBe(0)
  })

  it('a random share: preview and start pick the same records', async () => {
    const records = await createSentences(10, [alice.id])
    signInAs(sam)
    const body = {
      sentenceIds: records.map(r => r.id),
      firstUserId: alice.id,
      secondUserId: bob.id,
      sample: 30,
      seed: 42
    }
    const preview = await start(body)
    expect(preview.sampled).toBe(3)
    expect(preview.counts.fresh).toBe(3)
    const started = await prisma.doubleRound.findMany({ select: { sentenceId: true } })
    expect(started).toHaveLength(3)
    // The same seed draws the same records.
    const again = await post(startRoute, { ...body, dryRun: true })
    expect(again.body.counts).toMatchObject({ already: 3, fresh: 0 })
  })

  it('bulk hand-over moves unstarted parts; the preview explains what is skipped', async () => {
    const [r1, r2, r3] = await createSentences(3, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r1.id, r2.id, r3.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(bob)
    await save(r3.id, path('02')) // Bob started r3

    signInAs(sam)
    const body = { action: 'hand_over', sentenceIds: [r1.id, r2.id, r3.id], fromUserId: bob.id, toUserId: carol.id }
    const preview = await post(commandsRoute, { ...body, dryRun: true })
    expect(preview.body).toMatchObject({ applied: 2, skipped: { 'The part is already done': 1 } })
    expect(await prisma.doubleTask.count({ where: { assigneeId: carol.id } })).toBe(0) // nothing changed yet
    expect((await post(commandsRoute, body)).body.applied).toBe(2)
    expect(await prisma.doubleTask.count({ where: { assigneeId: carol.id, status: 'pending' } })).toBe(2)

    // Accept single applies where every taxonomy has a label: only r3 (Bob's answer).
    const accept = await post(commandsRoute, {
      action: 'accept_single',
      sentenceIds: [r1.id, r2.id, r3.id],
      reason: 'enough',
      dryRun: true
    })
    expect(accept.body).toMatchObject({ applied: 1, skipped: { 'A taxonomy has no label yet': 2 } })
  })

  it('queue counts per double annotation state, and the disagreement in the row', async () => {
    const [r1, r2] = await createSentences(2, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r1.id, r2.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(alice)
    await save(r1.id, path('01', '011'))
    signInAs(bob)
    await save(r1.id, path('01', '012'))

    signInAs(sam)
    const stats = await (await statsRoute.GET(request('/x/stats?double=review'), params())).json()
    expect(stats.stats.double).toEqual({ any: 2, waiting: 1, review: 1, gap: 0, done: 0 })
    const list = await (await listRoute.GET(request('/x?double=review'), params())).json()
    expect(list.sentences[0].double.disputes).toEqual([{ taxonomyKey: 'A', a: '011', b: '012', level: 2 }])
  })

  it('progress: agreement by level, by labeller and the most frequent disagreements', async () => {
    const [r1, r2] = await createSentences(2, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r1.id, r2.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(alice)
    await save(r1.id, path('01', '011'))
    await save(r2.id, path('02'))
    signInAs(bob)
    await save(r1.id, path('01', '012'))
    await save(r2.id, path('02'))

    signInAs(sam)
    const overview = await (await overviewRoute.GET(request('/x/overview'), params())).json()
    const double = overview.double
    expect(double.agreementByLevel).toEqual([
      { taxonomyKey: 'A', compared: 2, agreed: [2, 1], levelNames: expect.any(Array) }
    ])
    expect(double.labellers).toEqual(
      expect.arrayContaining([{ name: alice.name, compared: 2, agreed: 1, decided: 0, chosen: 0 }])
    )
    expect(double.confusions).toEqual([
      expect.objectContaining({ taxonomyKey: 'A', level: 2, a: '011', b: '012', count: 1 })
    ])
    expect(double.waiting).toEqual({ over3: 0, over7: 0, over14: 0 })

    // The disagreement links to its records in the queue (codes either way round).
    const records = async (value: string) =>
      (await (await listRoute.GET(request(`/x?disagreement=${value}`), params())).json()).sentences.map(
        (s: { id: string }) => s.id
      )
    expect(await records('A,2,012,011')).toEqual([r1.id])
    expect(await records('A,1,01,02')).toEqual([])
    expect(await records('A,x,011,012')).toEqual([])
  })
})
