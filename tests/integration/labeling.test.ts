import { beforeEach, describe, expect, it } from 'vitest'
import type { Taxonomy, User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createSentences, createTaxonomy, createUser, params, request, resetDatabase, signInAs } from './helpers'

import * as annotationsRoute from '@/app/api/sentences/[sentenceId]/annotations/route'
import * as bulkRoute from '@/app/api/sentences/bulk-label/route'

// Each test gets two active taxonomies (A, B) and a labeller assigned to fresh records.
let labeller: User
let taxA: Taxonomy, taxB: Taxonomy

beforeEach(async () => {
  await resetDatabase()
  labeller = await createUser('labeller')
  taxA = await createTaxonomy('A')
  taxB = await createTaxonomy('B')
  signInAs(labeller)
})

type Label = { level: number; nodeCode: string | number }
const save = (sentenceId: string, body: { annotations: Array<Label & { taxonomyKey: string }>; status: string; flagged?: boolean }) =>
  annotationsRoute.POST(
    request(`/api/sentences/${sentenceId}/annotations`, { method: 'POST', body }),
    params({ sentenceId })
  )
const pathA = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode, taxonomyKey: 'A' }))
const pathB = (...codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode, taxonomyKey: 'B' }))
const bulk = (body: Record<string, unknown>) => bulkRoute.POST(request('/api/sentences/bulk-label', { method: 'POST', body }))
const statusOf = async (id: string) => (await prisma.sentence.findUniqueOrThrow({ where: { id } })).status
const labelsOf = async (id: string, taxonomyId: string) =>
  (await prisma.sentenceAnnotation.findMany({ where: { sentenceId: id, taxonomyId }, orderBy: { level: 'asc' } }))
    .map(a => a.nodeCode)

describe('single-record saves', () => {
  it('rejects incomplete, broken, numeric and mixed-taxonomy paths without writing', async () => {
    const [r] = await createSentences(1, [labeller.id])
    expect((await save(r.id, { annotations: pathA('01'), status: 'submitted' })).status).toBe(400) // not a leaf
    expect((await save(r.id, { annotations: pathA('02', '011'), status: 'submitted' })).status).toBe(400) // wrong parent
    expect((await save(r.id, { annotations: [{ level: 1, nodeCode: 2, taxonomyKey: 'A' }], status: 'submitted' })).status).toBe(400)
    expect((await save(r.id, { annotations: [...pathA('02'), { level: 1, nodeCode: '02', taxonomyKey: 'B' }], status: 'submitted' })).status).toBe(400)
    expect(await prisma.sentenceAnnotation.count()).toBe(0)
    expect(await statusOf(r.id)).toBe('pending')
  })

  it('completes only when every active taxonomy has human labels, keeping the other taxonomy', async () => {
    const [r] = await createSentences(1, [labeller.id])
    const first = await save(r.id, { annotations: pathA('01', '011'), status: 'submitted' })
    expect(first.status).toBe(200)
    expect((await first.json()).status).toBe('pending')

    const second = await (await save(r.id, { annotations: pathB('01', '-99'), status: 'submitted' })).json()
    expect(second.status).toBe('submitted')
    expect(second.allCompleted).toBe(true)
    expect(await labelsOf(r.id, taxA.id)).toEqual(['01', '011'])
    expect(await labelsOf(r.id, taxB.id)).toEqual(['01', '-99'])

    // Re-labelling A replaces A only.
    await save(r.id, { annotations: pathA('02'), status: 'submitted' })
    expect(await labelsOf(r.id, taxA.id)).toEqual(['02'])
    expect(await labelsOf(r.id, taxB.id)).toEqual(['01', '-99'])
  })

  it('AI suggestions do not count towards completion', async () => {
    const [r] = await createSentences(1, [labeller.id])
    await prisma.sentenceAISuggestion.create({
      data: { sentenceId: r.id, taxonomyId: taxB.id, level: 1, nodeCode: '02', confidenceScore: 0.9 },
    })
    await save(r.id, { annotations: pathA('02'), status: 'submitted' })
    expect(await statusOf(r.id)).toBe('pending')
  })

  it('flag-only saves neither complete a record nor un-skip it', async () => {
    const [r] = await createSentences(1, [labeller.id])
    await save(r.id, { annotations: [], status: 'skipped' })
    expect(await statusOf(r.id)).toBe('skipped')
    await save(r.id, { annotations: [], status: 'pending', flagged: true }) // what the bulk flag button sends
    const after = await prisma.sentence.findUniqueOrThrow({ where: { id: r.id } })
    expect(after.status).toBe('skipped')
    expect(after.flagged).toBe(true)
  })

  it('with no active taxonomy nothing completes', async () => {
    await prisma.taxonomy.updateMany({ data: { isActive: false } })
    const [r] = await createSentences(1, [labeller.id])
    await save(r.id, { annotations: pathA('02'), status: 'submitted' })
    expect(await statusOf(r.id)).toBe('pending')
  })

  it('counts a changed path once for learning, not repeated identical saves', async () => {
    const [r] = await createSentences(1, [labeller.id])
    await save(r.id, { annotations: pathA('01', '011'), status: 'submitted' })
    await save(r.id, { annotations: pathA('01', '011'), status: 'submitted' })
    expect((await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxA.id } })).newAnnotationsSinceLastLearning).toBe(2)
    await save(r.id, { annotations: pathA('02'), status: 'submitted' })
    expect((await prisma.taxonomy.findUniqueOrThrow({ where: { id: taxA.id } })).newAnnotationsSinceLastLearning).toBe(3)
  })

  it('concurrent saves serialise: the result is exactly one of the submitted paths', async () => {
    const [r] = await createSentences(1, [labeller.id])
    const results = await Promise.all([
      save(r.id, { annotations: pathA('01', '011'), status: 'submitted' }),
      save(r.id, { annotations: pathA('02'), status: 'submitted' }),
      save(r.id, { annotations: pathA('01', '012'), status: 'submitted' }),
    ])
    expect(results.map(res => res.status)).toEqual([200, 200, 200])
    const final = (await labelsOf(r.id, taxA.id)).join('/')
    expect(['01/011', '02', '01/012']).toContain(final)
  })
})

describe('bulk saves', () => {
  it('sets each record by the shared rules instead of always submitted', async () => {
    const [done, fresh] = await createSentences(2, [labeller.id])
    await save(done.id, { annotations: pathB('02'), status: 'submitted' })

    const res = await bulk({ sentenceIds: [done.id, fresh.id], taxonomyKey: 'A', annotations: pathA('01', '-99').map(({ level, nodeCode }) => ({ level, nodeCode })) })
    expect(res.status).toBe(200)
    expect(await statusOf(done.id)).toBe('submitted') // A + B
    expect(await statusOf(fresh.id)).toBe('pending') // A only
  })

  it('flag/comment-only bulk requests leave statuses alone', async () => {
    const [a, b] = await createSentences(2, [labeller.id])
    await save(b.id, { annotations: [], status: 'skipped' })
    const res = await bulk({ sentenceIds: [a.id, b.id], taxonomyKey: 'A', flagged: true, comment: 'check' })
    expect(res.status).toBe(200)
    expect(await statusOf(a.id)).toBe('pending')
    expect(await statusOf(b.id)).toBe('skipped')
    expect(await prisma.comment.count({ where: { authorId: labeller.id } })).toBe(2)
  })

  it('rejects an invalid path without touching any record', async () => {
    const [a, b] = await createSentences(2, [labeller.id])
    const res = await bulk({ sentenceIds: [a.id, b.id], taxonomyKey: 'A', annotations: [{ level: 1, nodeCode: '01' }] })
    expect(res.status).toBe(400)
    expect(await prisma.sentenceAnnotation.count()).toBe(0)
  })

  it('rejects numeric codes (leading zeros would be lost)', async () => {
    const [a] = await createSentences(1, [labeller.id])
    const res = await bulk({ sentenceIds: [a.id], taxonomyKey: 'A', annotations: [{ level: 1, nodeCode: 2 }] })
    expect(res.status).toBe(400)
  })
})
