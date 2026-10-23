import { beforeEach, describe, expect, it } from 'vitest'
import type { Taxonomy, User } from '@/lib/generated/prisma/client'
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
import * as recordRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/route'
import * as commentsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/comments/route'
import * as startRoute from '@/app/api/workspaces/[workspaceId]/sentences/double-annotation/route'
import * as commandRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/double-annotation/route'
import * as bulkRoute from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'
import * as listRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'
import * as overviewRoute from '@/app/api/workspaces/[workspaceId]/progress/overview/route'

// Two active taxonomies (A, B); alice and bob label, sam supervises them, ann is admin.
let alice: User, bob: User, carol: User, sam: User, ann: User, outsider: User
let taxA: Taxonomy

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  ann = await createUser('admin')
  sam = await createUser('supervisor')
  alice = await createUser('labeller', { supervisorId: sam.id })
  bob = await createUser('labeller', { supervisorId: sam.id })
  carol = await createUser('labeller', { supervisorId: sam.id })
  outsider = await createUser('labeller')
  taxA = await createTaxonomy('A')
  await createTaxonomy('B')
})

const path = (key: string, ...codes: string[]) =>
  codes.map((nodeCode, i) => ({ level: i + 1, nodeCode, taxonomyKey: key }))
const save = (sentenceId: string, annotations: ReturnType<typeof path>, status = 'submitted') =>
  annotationsRoute.POST(
    request(`/x/${sentenceId}/annotations`, { method: 'POST', body: { annotations, status } }),
    params({ sentenceId })
  )
const start = async (body: Record<string, unknown>) => {
  const preview = await startRoute.POST(request('/x', { method: 'POST', body: { ...body, dryRun: true } }), params())
  const { counts } = await preview.json()
  return startRoute.POST(request('/x', { method: 'POST', body: { ...body, expect: counts } }), params())
}
const command = (sentenceId: string, body: Record<string, unknown>) =>
  commandRoute.POST(request('/x', { method: 'POST', body }), params({ sentenceId }))
const record = async (sentenceId: string) =>
  (await recordRoute.GET(request(`/x/${sentenceId}`), params({ sentenceId }))).json()
const effective = async (sentenceId: string, taxonomyId: string) =>
  (await prisma.sentenceAnnotation.findMany({ where: { sentenceId, taxonomyId }, orderBy: { level: 'asc' } })).map(
    a => a.nodeCode
  )
const statusOf = async (id: string) => (await prisma.sentence.findUniqueOrThrow({ where: { id } })).status
const exportCsv = async () => {
  signInAs(ann)
  return (await exportRoute.GET(request('/x/export'), params())).text()
}

describe('double annotation', () => {
  it('assign both up front: first answer is provisional, matching answers confirm', async () => {
    const [r] = await createSentences(1, [alice.id])
    signInAs(sam)
    expect((await start({ sentenceIds: [r.id], firstUserId: alice.id, secondUserId: bob.id })).status).toBe(200)

    // Bob finishes first; his answer is the result straight away.
    signInAs(bob)
    expect((await save(r.id, path('A', '01', '011'))).status).toBe(200)
    expect(await effective(r.id, taxA.id)).toEqual(['01', '011'])
    expect(await statusOf(r.id)).toBe('pending')

    // Alice sees nothing of Bob's answer.
    signInAs(alice)
    const view = await record(r.id)
    expect(view.annotations).toEqual([])
    expect(view.double).toBeNull()
    expect(view.labeling).toEqual({ editableTaxonomies: ['A', 'B'] })
    expect(view.lastEditedAt).toBeNull()
    expect(view.assignments).toEqual([{ userId: alice.id }])

    expect((await save(r.id, path('A', '01', '011'))).status).toBe(200)
    const both = await prisma.doubleOutcome.findFirstOrThrow({ where: { taxonomyId: taxA.id } })
    expect(both).toMatchObject({ state: 'agreed', matched: true })

    // B: both agree on 02 -> the record is confirmed.
    await save(r.id, path('B', '02'))
    signInAs(bob)
    const res = await (await save(r.id, path('B', '02'))).json()
    expect(res).toMatchObject({ status: 'submitted', allCompleted: true })
    expect(await statusOf(r.id)).toBe('submitted')
    expect((await prisma.doubleRound.findFirstOrThrow()).status).toBe('completed')
  })

  it('disagreement keeps the first answer until a reviewer decides; nobody reviews their own pair', async () => {
    const [r] = await createSentences(1, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    await save(r.id, path('B', '02'))
    signInAs(bob)
    await save(r.id, path('A', '01', '012'))
    await save(r.id, path('B', '02'))

    // Answers are final.
    expect((await save(r.id, path('A', '02'))).status).toBe(409)
    expect(await effective(r.id, taxA.id)).toEqual(['01', '011']) // Alice's, the first
    expect(await statusOf(r.id)).toBe('pending')

    // Bulk labels cannot bypass the review.
    signInAs(ann)
    const bulk = await bulkRoute.POST(
      request('/x', { method: 'POST', body: { sentenceIds: [r.id], taxonomyKey: 'A', annotations: path('A', '02') } }),
      params()
    )
    expect(bulk.status).toBe(409)

    // The supervisor sees both answers and picks a third path.
    signInAs(sam)
    const view = await record(r.id)
    expect(view.double.mode).toBe('manager')
    expect(view.double.canReview).toBe(true)
    const a = view.double.outcomes.find((o: { taxonomyKey: string }) => o.taxonomyKey === 'A')
    expect(a.state).toBe('disagreed')
    expect(a.answers.map((x: { labels: Array<{ nodeCode: string }> }) => x.labels.map(l => l.nodeCode))).toEqual([
      ['01', '011'],
      ['01', '012']
    ])
    expect((await save(r.id, path('A', '02'))).status).toBe(200)
    expect(await effective(r.id, taxA.id)).toEqual(['02'])
    expect(await statusOf(r.id)).toBe('submitted')
    const outcome = await prisma.doubleOutcome.findFirstOrThrow({ where: { taxonomyId: taxA.id } })
    expect(outcome).toMatchObject({ state: 'reviewed', matched: false, reviewedById: sam.id }) // comparison kept

    // Progress: one compared pair matched (B), one did not (A); the review counts separately.
    const overview = await (await overviewRoute.GET(request('/x/progress/overview'), params())).json()
    expect(overview.double).toMatchObject({ inProgress: 0, needsReview: 0, confirmed: 1, reviewedInPeriod: 1 })
    expect(overview.double.agreement).toEqual([
      { taxonomyKey: 'A', agreed: 0, compared: 1 },
      { taxonomyKey: 'B', agreed: 1, compared: 1 }
    ])
    expect(overview.activity.labeledRecords).toBe(1) // labelling only, not the review
    signInAs(alice)
    expect((await (await overviewRoute.GET(request('/x/progress/overview'), params())).json()).double).toBeNull()

    // A participant manager cannot review.
    const [r2] = await createSentences(1, [alice.id])
    signInAs(ann)
    await start({ sentenceIds: [r2.id], firstUserId: sam.id, secondUserId: alice.id })
    signInAs(sam)
    expect((await record(r2.id)).double.mode).toBe('task')
  })

  it('a second annotation for labelled records keeps the first labels and only asks the other person', async () => {
    const [r] = await createSentences(1, [carol.id])
    signInAs(carol)
    await save(r.id, path('A', '02'))
    await save(r.id, path('B', '01', '011'))
    expect(await statusOf(r.id)).toBe('submitted')

    signInAs(sam)
    const preview = await (
      await startRoute.POST(
        request('/x', { method: 'POST', body: { sentenceIds: [r.id], secondUserId: bob.id, dryRun: true } }),
        params()
      )
    ).json()
    expect(preview.counts).toEqual({ fresh: 0, labelled: 1, already: 0, needs_first: 0 })
    await start({ sentenceIds: [r.id], secondUserId: bob.id })
    expect(await statusOf(r.id)).toBe('pending') // provisional again
    expect(await effective(r.id, taxA.id)).toEqual(['02']) // labels kept

    let csv = await exportCsv()
    expect(csv.split('\n')[0]).toContain('annotation_status')
    expect(csv).toContain('provisional')

    signInAs(bob)
    expect((await record(r.id)).annotations).toEqual([]) // blind
    await save(r.id, path('A', '02'))
    await save(r.id, path('B', '01', '011'))
    expect(await statusOf(r.id)).toBe('submitted')
    csv = await exportCsv()
    expect(csv).toContain('confirmed')
  })

  it('accept single and stop; reassign only unstarted parts', async () => {
    const [r1, r2] = await createSentences(2, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r1.id, r2.id], firstUserId: alice.id, secondUserId: bob.id })

    // Nothing labelled yet: accepting is refused.
    expect((await command(r1.id, { action: 'accept_single', reason: 'x' })).status).toBe(409)
    // Bob has not started: hand his part to Carol, not to Alice (same person twice).
    expect((await command(r1.id, { action: 'reassign', position: 2, userId: alice.id })).status).toBe(400)
    expect((await command(r1.id, { action: 'reassign', position: 2, userId: outsider.id })).status).toBe(403)
    expect((await command(r1.id, { action: 'reassign', position: 2, userId: carol.id })).status).toBe(200)

    signInAs(alice)
    await save(r1.id, path('A', '02'))
    await save(r1.id, path('B', '02'))
    signInAs(sam)
    expect((await command(r1.id, { action: 'accept_single', reason: 'Carol is on leave' })).status).toBe(200)
    expect(await statusOf(r1.id)).toBe('submitted')
    expect((await prisma.doubleTask.findFirstOrThrow({ where: { sentenceId: r1.id, position: 2 } })).status).toBe(
      'cancelled'
    )

    expect((await command(r2.id, { action: 'stop', reason: 'not needed' })).status).toBe(200)
    signInAs(alice)
    expect((await save(r2.id, path('A', '02'))).status).toBe(200) // ordinary work again
    expect(await effective(r2.id, taxA.id)).toEqual(['02'])
  })

  it('labellers see their own part in queue tabs and only their own comments', async () => {
    const [r] = await createSentences(1, [alice.id])
    signInAs(sam)
    await start({ sentenceIds: [r.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    await save(r.id, path('B', '02'))
    await commentsRoute.POST(
      request('/x', { method: 'POST', body: { body: 'I chose 011' } }),
      params({ sentenceId: r.id })
    )
    const ownProgress = await (await overviewRoute.GET(request('/x/progress/overview'), params())).json()
    expect(ownProgress.workload).toMatchObject({ complete: 1, pending: 0 })
    expect(ownProgress.double).toBeNull()

    const list = async (query: string) =>
      (await (await listRoute.GET(request(`/x/sentences?${query}`), params())).json()).sentences as Array<{
        id: string
        annotations: Array<{ nodeCode: string }>
      }>
    expect((await list('status=submitted')).map(s => s.id)).toEqual([r.id]) // Alice: done
    signInAs(bob)
    expect((await list('status=pending')).map(s => s.id)).toEqual([r.id]) // Bob: still to do
    const [row] = await list('status=pending')
    expect(row!.annotations).toEqual([]) // no provisional label shown
    expect(await list('taxonomyKey=A&code=011')).toEqual([]) // label filters cannot probe
    const comments = await (
      await commentsRoute.GET(request(`/x?includeResolved=true`), params({ sentenceId: r.id }))
    ).json()
    expect(comments.comments).toEqual([])
  })

  it('keeps workflow metadata, other assignees, edits and comment counts out of labeller reads and filters', async () => {
    const [r] = await createSentences(1, [alice.id, bob.id, carol.id])
    signInAs(sam)
    await start({ sentenceIds: [r.id], firstUserId: alice.id, secondUserId: bob.id })
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    await commentsRoute.POST(
      request('/x', { method: 'POST', body: { body: 'Private answer note' } }),
      params({ sentenceId: r.id })
    )

    signInAs(bob)
    const detail = await record(r.id)
    expect(detail.double).toBeNull()
    expect(detail.labeling).toEqual({ editableTaxonomies: ['A', 'B'] })
    expect(detail.assignments).toEqual([{ userId: bob.id }])
    expect(detail.lastEditedAt).toBeNull()
    expect(detail.commentSummary).toEqual({ total: 0, unresolved: 0 })
    expect(detail._count.comments).toBe(0)
    const list = async (query = '') =>
      (await (await listRoute.GET(request(`/x/sentences?${query}`), params())).json()).sentences
    const [row] = await list()
    expect(row.double).toBeNull()
    expect(row.assignments.map((a: { user: { id: string } }) => a.user.id)).toEqual([bob.id])
    expect(row.lastEditor).toBeNull()
    expect(row.lastEditedAt).toBeNull()
    expect(row._count.comments).toBe(0)
    expect(await list('hasComments=true')).toEqual([])
    expect((await list('hasComments=false')).map((s: { id: string }) => s.id)).toEqual([r.id])
    expect(await list(`assignedToUserId=${alice.id}`)).toEqual([])
    expect(await list(`lastEditorId=${alice.id}`)).toEqual([])

    await save(r.id, path('A', '02'))
    const ownView = await record(r.id)
    expect(ownView.labeling).toEqual({ editableTaxonomies: ['B'] })
    expect(ownView.annotations.map((a: { nodeCode: string }) => a.nodeCode)).toEqual(['02'])
    const resubmit = await save(r.id, path('A', '01', '012'))
    expect(resubmit.status).toBe(409)
    expect((await resubmit.json()).error).not.toMatch(/double|independent|differences|other people/i)
    const bulk = await bulkRoute.POST(
      request('/x', { method: 'POST', body: { sentenceIds: [r.id], taxonomyKey: 'B', annotations: path('B', '02') } }),
      params()
    )
    expect(bulk.status).toBe(409)
    expect((await bulk.json()).error).not.toMatch(/double|independent|other people/i)

    signInAs(carol)
    const hidden = await record(r.id)
    expect(hidden.double).toBeNull()
    expect(hidden.labeling).toEqual({ editableTaxonomies: [] })
    expect(hidden.annotations).toEqual([])
    const denied = await save(r.id, path('A', '02'))
    expect(denied.status).toBe(403)
    expect((await denied.json()).error).not.toMatch(/double|independent|other people/i)
  })
})
