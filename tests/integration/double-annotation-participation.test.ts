import { inflateRawSync } from 'node:zlib'
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
import * as summaryRoute from '@/app/api/workspaces/[workspaceId]/export/summary/route'
import * as commandsRoute from '@/app/api/workspaces/[workspaceId]/sentences/double-annotation/commands/route'

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

/** The files of a ZIP (stored or deflated), from its central directory. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22
  let at = zip.readUInt32LE(end + 16)
  const files: Record<string, string> = {}
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const compressed = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const offset = zip.readUInt32LE(at + 42)
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    files[zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')] = inflateRawSync(
      zip.subarray(start, start + compressed)
    ).toString('utf8')
    at += 46 + nameLength
  }
  return files
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

  it('give back as ordinary work: the person then sees and changes the record like any other', async () => {
    const r = await reviewedRecord()
    const release = async (body: Record<string, unknown>) => {
      const res = await commandsRoute.POST(
        request('/x', {
          method: 'POST',
          body: { action: 'release', sentenceIds: [r.id], reason: 'left the study', ...body }
        }),
        params()
      )
      return { status: res.status, body: await res.json() }
    }

    // Labellers cannot; a person without a part is skipped.
    signInAs(alice)
    expect((await release({ userId: alice.id })).status).toBe(403)
    signInAs(sam)
    expect((await release({ userId: sam.id, dryRun: true })).body).toMatchObject({
      applied: 0,
      skipped: { 'The person has no part in it': 1 }
    })
    expect((await release({ userId: alice.id, dryRun: true })).body).toMatchObject({ applied: 1 })
    expect((await release({ userId: alice.id })).body).toMatchObject({ applied: 1 })
    const task = await prisma.doubleTask.findFirstOrThrow({ where: { sentenceId: r.id, assigneeId: alice.id } })
    expect(task).toMatchObject({ status: 'submitted', releasedById: sam.id })
    expect(await prisma.auditLog.count({ where: { action: 'double.released' } })).toBe(1)

    // Alice now sees the confirmed result and every comment, like ordinary work.
    signInAs(alice)
    const view = await record(r.id)
    expect(codes(view.annotations, 'A')).toEqual(['01', '012'])
    expect(view.commentSummary.total).toBe(2)
    expect((await list('taxonomyKey=A&code=012')).map(s => s.id)).toEqual([r.id])
    // Her change is an ordinary label change: the result moves, the export says single.
    expect((await save(r.id, path('A', '01', '011'))).status).toBe(200)
    expect(await effective(r.id, taxA.id)).toEqual(['01', '011'])
    const [row] = await exportRow(r)
    expect(row).toMatchObject({ A_2: '011', A_annotation_status: 'single' })

    // Bob still participates: he keeps seeing only his own work.
    signInAs(bob)
    expect((await record(r.id)).commentSummary.total).toBe(1)

    // The manager's history names the release.
    signInAs(sam)
    const history = (await record(r.id)).double
    expect(history.tasks.find((t: { position: number }) => t.position === 1).releasedAt).toEqual(expect.any(String))
  })

  it('give back is refused while a round is open', async () => {
    const [r] = await createSentences(1, [alice.id])
    await start([r.id])
    signInAs(alice)
    await save(r.id, path('A', '01', '011'))
    signInAs(sam)
    const res = await commandsRoute.POST(
      request('/x', {
        method: 'POST',
        body: { action: 'release', sentenceIds: [r.id], userId: alice.id, reason: 'x', dryRun: true }
      }),
      params()
    )
    expect((await res.json()).skipped).toEqual({
      'Still in an open round: hand the part over or stop double annotation first': 1
    })
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

  it('analysis exports: pairs side by side with the match per level, and the agreement summary', async () => {
    const r = await reviewedRecord()
    signInAs(alice)
    await save(r.id, path('A', '02')) // a change after the comparison: the pair keeps the compared answer

    const pairs = await exportRow(r, '?format=pairs')
    const a = pairs.find(p => p.taxonomy === 'A')
    expect(a).toMatchObject({
      a_labeller: alice.name,
      a_code_1: '01',
      a_code_2: '011',
      a_revised: 'true',
      b_labeller: bob.name,
      b_code_2: '012',
      match_1: 'true',
      match_2: 'false',
      agreed_depth: '1',
      first_diff_level: '2',
      original_match: 'false',
      final_code_1: '01',
      final_code_2: '012',
      final_source: 'b',
      result_status: 'reviewed',
      reviewed_by: sam.name,
      field_text: 'record 0'
    })
    expect(pairs.find(p => p.taxonomy === 'B')).toMatchObject({ match_1: 'true', final_source: 'agreed' })
    expect((await exportRow(r, '?format=pairs&taxonomy=B')).map(p => p.taxonomy)).toEqual(['B'])
    expect(await exportRow(r, '?format=pairs&rounds=active')).toEqual([])

    signInAs(ann)
    const csv = await (await exportRoute.GET(request('/x/export?format=agreement'), params())).text()
    const lines = csv.split('\n').map(line => line.split(',').map(cell => cell.replace(/^"|"$/g, '')))
    const find = (...cells: string[]) => lines.find(l => cells.every((c, i) => c === '' || l[i] === c))
    // section, taxonomy, level, labeller, labeller_b, code_a, label_a, code_b, label_b, compared, agreed, share
    expect(find('level', 'A', '1')!.slice(9, 12)).toEqual(['1', '1', '1.0000'])
    expect(find('level', 'A', '2')!.slice(9, 11)).toEqual(['1', '0'])
    expect(find('level', 'A', 'full')!.slice(9, 11)).toEqual(['1', '0'])
    expect(find('confusion', 'A', '2')!.slice(5, 10)).toEqual(['011', 'Item 011', '012', 'Item 012', '1'])
    const bobRow = find('labeller', 'A', 'full', bob.name!)!
    expect(bobRow.slice(9, 14)).toEqual(['1', '0', '0.0000', '1', '1']) // the reviewer chose Bob's answer
    // Kappa: one pair that disagrees is below chance; a single code everywhere has none.
    expect(find('level', 'A', 'full')![14]).toBe('-1.0000')
    expect(find('level', 'A', '1')![14]).toBe('')

    // All three in one ZIP, each file as its own download gives it.
    const res = await exportRoute.GET(request('/x/export?format=analysis&taxonomy=A'), params())
    expect(res.headers.get('content-type')).toBe('application/zip')
    const files = unzip(Buffer.from(await res.arrayBuffer()))
    expect(Object.keys(files).every(name => !name.includes(':'))).toBe(true) // extractable on Windows
    expect(
      Object.keys(files).map(name => name.replace(/-[^-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.csv$/, ''))
    ).toEqual(['double-annotation-pairs', 'double-annotation-answers', 'double-annotation-agreement'])
    const single = async (format: string) =>
      (await exportRoute.GET(request(`/x/export?format=${format}&taxonomy=A`), params())).text()
    const [pairsCsv, answersCsv, agreementCsv] = Object.values(files)
    expect(pairsCsv).toBe(await single('pairs'))
    expect(answersCsv).toBe(await single('details'))
    expect(agreementCsv).toBe(await single('agreement'))
  })

  it('supervisors download the analysis of their team, without records they labelled', async () => {
    const r = await reviewedRecord()
    // A second round in which Sam labels himself (started by the admin).
    const [own] = await createSentences(1, [alice.id])
    signInAs(ann)
    const body = { sentenceIds: [own.id], firstUserId: sam.id, secondUserId: alice.id }
    const preview = await (
      await startRoute.POST(request('/x', { method: 'POST', body: { ...body, dryRun: true } }), params())
    ).json()
    expect(
      (await startRoute.POST(request('/x', { method: 'POST', body: { ...body, expect: preview.counts } }), params()))
        .status
    ).toBe(200)

    const download = async (format: string) => {
      const res = await exportRoute.GET(request(`/x/export?format=${format}`), params())
      return { status: res.status, text: res.status === 200 ? await res.text() : '' }
    }
    signInAs(sam)
    expect((await download('records')).status).toBe(403)
    const pairs = await download('pairs')
    expect(pairs.status).toBe(200)
    expect(pairs.text).toContain(r.recordKey)
    expect(pairs.text).not.toContain(own.recordKey) // his own part: never the other answer
    expect((await download('details')).text).not.toContain(own.recordKey)
    expect((await download('analysis')).status).toBe(200)
    const summary = await (await summaryRoute.GET(request('/x/export/summary'), params())).json()
    expect(summary).toMatchObject({ rounds: 1, pairs: 2 })

    // A supervisor without this team sees none of it; labellers cannot download.
    const sue = await createUser('supervisor')
    signInAs(sue)
    expect((await download('pairs')).text).not.toContain(r.recordKey)
    signInAs(alice)
    expect((await download('pairs')).status).toBe(403)
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
