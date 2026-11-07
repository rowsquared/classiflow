import { beforeEach, describe, expect, it } from 'vitest'
import type { Sentence, Taxonomy, User } from '@/lib/generated/prisma/client'
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
import * as flagRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/flag/route'
import * as startRoute from '@/app/api/workspaces/[workspaceId]/sentences/double-annotation/route'
import * as commandRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/double-annotation/route'
import * as bulkRoute from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'
import * as listRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'

// Sticky participation (docs/plans/double-annotation-v2.md section 2): whoever
// holds a part in a round sees only their own work on that record, for good,
// and can change it like any record without changing the result.
let alice: User, bob: User, sam: User, ann: User
let taxA: Taxonomy

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  ann = await createUser('admin')
  sam = await createUser('supervisor')
  alice = await createUser('labeller', { supervisorId: sam.id })
  bob = await createUser('labeller', { supervisorId: sam.id })
  taxA = await createTaxonomy('A')
  await createTaxonomy('B')
})

const path = (key: string, ...codes: string[]) =>
  codes.map((nodeCode, i) => ({ level: i + 1, nodeCode, taxonomyKey: key }))
const save = (
  sentenceId: string,
  annotations: ReturnType<typeof path>,
  status = 'submitted',
  extra: Record<string, unknown> = {}
) =>
  annotationsRoute.POST(
    request(`/x/${sentenceId}/annotations`, { method: 'POST', body: { annotations, status, ...extra } }),
    params({ sentenceId })
  )
const start = async (sentenceIds: string[]) => {
  signInAs(sam)
  const body = { sentenceIds, firstUserId: alice.id, secondUserId: bob.id }
  const preview = await startRoute.POST(request('/x', { method: 'POST', body: { ...body, dryRun: true } }), params())
  const { counts } = await preview.json()
  expect(
    (await startRoute.POST(request('/x', { method: 'POST', body: { ...body, expect: counts } }), params())).status
  ).toBe(200)
}
const record = async (sentenceId: string) =>
  (await recordRoute.GET(request(`/x/${sentenceId}`), params({ sentenceId }))).json()
const codes = (annotations: Array<{ taxonomy: { key: string }; nodeCode: string }>, key: string) =>
  annotations.filter(a => a.taxonomy.key === key).map(a => a.nodeCode)
const effective = async (sentenceId: string, taxonomyId: string) =>
  (await prisma.sentenceAnnotation.findMany({ where: { sentenceId, taxonomyId }, orderBy: { level: 'asc' } })).map(
    a => a.nodeCode
  )
const list = async (query = '') =>
  (await (await listRoute.GET(request(`/x/sentences?${query}`), params())).json()).sentences as Array<{
    id: string
    flagged: boolean
    annotations: Array<{ taxonomy: { key: string }; nodeCode: string }>
    lastEditor: { id: string } | null
  }>
const flag = (sentenceId: string, flagged: boolean) =>
  flagRoute.POST(request('/x', { method: 'POST', body: { flagged } }), params({ sentenceId }))
/** The export row of a record as header -> value. */
const exportRow = async (r: Sentence, format = '') => {
  signInAs(ann)
  const csv = await (await exportRoute.GET(request(`/x/export${format}`), params())).text()
  const [header, ...rows] = csv.split('\n').map(line => line.split(',').map(cell => cell.replace(/^"|"$/g, '')))
  return rows
    .filter(row => row[0] === r.recordKey)
    .map(row => Object.fromEntries(header!.map((h, i) => [h, row[i] ?? ''])))
}

/** Alice and Bob label A differently and B alike; Sam picks Bob's A. */
async function reviewedRecord() {
  const [r] = await createSentences(1, [alice.id])
  await start([r.id])
  signInAs(alice)
  await save(r.id, path('A', '01', '011'))
  await save(r.id, path('B', '02'))
  await commentsRoute.POST(
    request('/x', { method: 'POST', body: { body: 'Alice note' } }),
    params({ sentenceId: r.id })
  )
  signInAs(bob)
  await save(r.id, path('A', '01', '012'))
  await save(r.id, path('B', '02'))
  await commentsRoute.POST(request('/x', { method: 'POST', body: { body: 'Bob note' } }), params({ sentenceId: r.id }))
  signInAs(sam)
  expect((await save(r.id, path('A', '01', '012'))).status).toBe(200)
  expect((await prisma.doubleRound.findFirstOrThrow({ where: { sentenceId: r.id } })).status).toBe('completed')
  return r
}

describe('double annotation participation', () => {
  it('after the review each labeller still sees only their own work', async () => {
    const r = await reviewedRecord()

    signInAs(alice)
    const view = await record(r.id)
    expect(codes(view.annotations, 'A')).toEqual(['01', '011']) // hers, not the decision
    expect(view).toMatchObject({ status: 'submitted', lastEditorId: alice.id, double: null })
    expect(view.labeling).toEqual({ editableTaxonomies: null })
    expect(view.commentSummary.total).toBe(1)

    const [row] = await list()
    expect(codes(row!.annotations, 'A')).toEqual(['01', '011'])
    expect(row!.lastEditor?.id).toBe(alice.id)
    expect((await list('status=submitted')).map(s => s.id)).toEqual([r.id])
    // Filters see her own answer, as the row shows it.
    expect((await list('taxonomyKey=A&code=011')).map(s => s.id)).toEqual([r.id])
    expect(await list('taxonomyKey=A&code=012')).toEqual([])
    expect((await list('hasSubmittedLabels=true')).map(s => s.id)).toEqual([r.id])
    expect((await list(`lastEditorId=${alice.id}`)).map(s => s.id)).toEqual([r.id])
    const comments = await (await commentsRoute.GET(request('/x'), params({ sentenceId: r.id }))).json()
    expect(comments.comments.map((c: { body: string }) => c.body)).toEqual(['Alice note'])
  })

  it('a labeller who changes a reviewed answer changes only their own answer', async () => {
    const r = await reviewedRecord()
    signInAs(alice)
    expect((await save(r.id, path('A', '02'))).status).toBe(200)
    expect(codes((await record(r.id)).annotations, 'A')).toEqual(['02'])

    expect(await effective(r.id, taxA.id)).toEqual(['01', '012']) // the decision stands
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('submitted')
    const outcome = await prisma.doubleOutcome.findFirstOrThrow({ where: { sentenceId: r.id, taxonomyId: taxA.id } })
    expect(outcome).toMatchObject({ state: 'reviewed', matched: false, revisedAfterCompare: true })
    expect(outcome.resultCodes).toEqual(['01', '012'])

    const [row] = await exportRow(r)
    expect(row).toMatchObject({ A_1: '01', A_2: '012', A_annotation_status: 'reviewed' })
    const details = await exportRow(r, '?format=details')
    const aliceA = details.find(d => d.labeller === alice.name && d.taxonomy === 'A')
    expect(aliceA).toMatchObject({ code_1: '02', code_2: '', revision: '2', revised_after_compare: 'true' })
    // The original answer is kept.
    expect(await prisma.doubleTaskLabel.count({ where: { supersededAt: { not: null } } })).toBe(2)
  })

  it('a reviewer can change a confirmed result with a reason; other changes export as ordinary labels', async () => {
    const r = await reviewedRecord()
    signInAs(sam)
    // Deliberately only: override and a reason.
    expect((await save(r.id, path('A', '02'))).status).toBe(409)
    expect((await save(r.id, path('A', '02'), 'submitted', { override: true })).status).toBe(400)
    expect((await save(r.id, path('A', '02'), 'submitted', { override: true, reviewNote: 'Recode' })).status).toBe(200)
    const outcome = await prisma.doubleOutcome.findFirstOrThrow({ where: { sentenceId: r.id, taxonomyId: taxA.id } })
    expect(outcome).toMatchObject({ state: 'reviewed', reviewedById: sam.id, resultCodes: ['02'], note: 'Recode' })
    // Bulk labels never change a confirmed result.
    const bulk = await bulkRoute.POST(
      request('/x', { method: 'POST', body: { sentenceIds: [r.id], taxonomyKey: 'A', annotations: path('A', '02') } }),
      params()
    )
    expect(bulk.status).toBe(409)
    expect((await exportRow(r))[0]).toMatchObject({ A_1: '02', A_annotation_status: 'reviewed' })

    // Labels that no longer match the confirmed path (written outside the workflow).
    await prisma.sentenceAnnotation.updateMany({
      where: { sentenceId: r.id, taxonomyId: taxA.id },
      data: { nodeCode: '03' }
    })
    expect((await exportRow(r))[0]).toMatchObject({ A_1: '03', A_annotation_status: 'single' })
  })

  it('undo a decision: the comparison and the first answer come back; the manager view keeps the history', async () => {
    const r = await reviewedRecord()
    signInAs(sam)
    const history = (await record(r.id)).double
    expect(history).toMatchObject({ mode: 'manager', status: 'completed', canReview: true })
    const a = history.outcomes.find((o: { taxonomyKey: string }) => o.taxonomyKey === 'A')
    expect(a).toMatchObject({ state: 'reviewed', reviewedBy: sam.name, resultCodes: ['01', '012'] })

    const reopen = await commandRoute.POST(
      request('/x', { method: 'POST', body: { action: 'reopen', taxonomyKey: 'A' } }),
      params({ sentenceId: r.id })
    )
    expect(reopen.status).toBe(200)
    const outcome = await prisma.doubleOutcome.findFirstOrThrow({ where: { sentenceId: r.id, taxonomyId: taxA.id } })
    expect(outcome).toMatchObject({ state: 'disagreed', reviewedById: null, resultCodes: [] })
    expect(await effective(r.id, taxA.id)).toEqual(['01', '011']) // Alice's, the first answer
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('pending')
    expect((await prisma.doubleRound.findFirstOrThrow({ where: { sentenceId: r.id } })).status).toBe('active')
    // A decision on an agreed taxonomy is an override too.
    expect((await save(r.id, path('B', '01', '011'))).status).toBe(409)
  })

  it('flags stay with the person who set them; managers see them', async () => {
    const [r] = await createSentences(1, [alice.id])
    await start([r.id])
    signInAs(alice)
    expect((await flag(r.id, true)).status).toBe(200)
    expect((await record(r.id)).flagged).toBe(true)
    expect((await list('flagged=true')).map(s => s.id)).toEqual([r.id])

    signInAs(bob)
    expect((await record(r.id)).flagged).toBe(false)
    expect(await list('flagged=true')).toEqual([])
    const [row] = await list()
    expect(row!.flagged).toBe(false)

    signInAs(sam)
    expect((await record(r.id)).flagged).toBe(true)
    signInAs(alice)
    await flag(r.id, false)
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: r.id } })).flagged).toBe(false)
  })

  it('revisions: the provisional result follows the first answer; a changed agreement needs review', async () => {
    const [r] = await createSentences(1, [alice.id])
    await start([r.id])
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    await save(r.id, path('A', '01', '012'))
    expect(await effective(r.id, taxA.id)).toEqual(['01', '012'])

    signInAs(bob)
    await save(r.id, path('A', '01', '012'))
    const agreed = await prisma.doubleOutcome.findFirstOrThrow({ where: { sentenceId: r.id, taxonomyId: taxA.id } })
    expect(agreed).toMatchObject({ state: 'agreed', matched: true, resultCodes: ['01', '012'] })

    signInAs(alice)
    await save(r.id, path('A', '02'))
    const reopened = await prisma.doubleOutcome.findFirstOrThrow({ where: { sentenceId: r.id, taxonomyId: taxA.id } })
    // The comparison stays as it was; the taxonomy needs a decision now.
    expect(reopened).toMatchObject({ state: 'disagreed', matched: true, revisedAfterCompare: true, resultCodes: [] })
  })

  it('stopping keeps people who answered on their own answer; others lose access', async () => {
    const [r] = await createSentences(1, [alice.id])
    await start([r.id])
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    signInAs(sam)
    expect(
      (
        await commandRoute.POST(
          request('/x', { method: 'POST', body: { action: 'stop', reason: 'x' } }),
          params({ sentenceId: r.id })
        )
      ).status
    ).toBe(200)

    signInAs(alice)
    expect(codes((await record(r.id)).annotations, 'A')).toEqual(['01', '011'])
    signInAs(bob) // never answered
    expect((await recordRoute.GET(request('/x'), params({ sentenceId: r.id }))).status).toBe(403)
  })

  it('records look the same to a labeller whether or not they are double annotated', async () => {
    const [plain] = await createSentences(1, [alice.id])
    const [double] = await createSentences(1, [alice.id])
    await start([double.id])
    signInAs(alice)
    const a = await record(plain.id)
    const b = await record(double.id)
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
    expect(b.labeling).toEqual(a.labeling)
    const rows = await list()
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort())
  })
})
