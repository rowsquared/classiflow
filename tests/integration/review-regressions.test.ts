import { beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkspace,
  createUser,
  createTaxonomy,
  createSentences,
  params,
  prisma,
  request,
  resetDatabase,
  signInAs,
  wsId
} from './helpers'
import * as active from '@/app/api/workspaces/[workspaceId]/taxonomies/active/route'
import * as nodes from '@/app/api/workspaces/[workspaceId]/taxonomies/[key]/nodes/route'
import * as queue from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as bulk from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  signInAs(await createUser('admin'))
})

describe('taxonomy browser boundaries', () => {
  it('returns active taxonomies only', async () => {
    await createTaxonomy('ACTIVE')
    const hidden = await createTaxonomy('HIDDEN')
    await prisma.taxonomy.update({ where: { id: hidden.id }, data: { isActive: false } })
    const response = await active.GET(request('/x'), params())
    expect((await response.json()).taxonomies.map((t: { key: string }) => t.key)).toEqual(['ACTIVE'])
  })

  it('finds an exact ancestor beyond the first 2,000 nodes, preserving leading zeros', async () => {
    const taxonomy = await createTaxonomy('LARGE')
    await prisma.taxonomyNode.createMany({
      data: Array.from({ length: 2100 }, (_, i) => ({
        workspaceId: wsId(),
        taxonomyId: taxonomy.id,
        code: `0${String(i).padStart(4, '0')}`,
        label: `Node ${i}`,
        level: 1,
        isLeaf: true
      }))
    })
    const response = await nodes.GET(request('/x?code=02099'), params({ key: 'LARGE' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 1, items: [{ code: '02099' }] })
  })

  it.each(['offset=-1', 'limit=-1', 'limit=501', 'level=NaN', 'level=0', 'level=6', 'offset=1.5'])(
    'rejects invalid pagination or levels: %s',
    async query => {
      await createTaxonomy('A')
      const response = await nodes.GET(request(`/x?${query}`), params({ key: 'A' }))
      expect(response.status).toBe(400)
    }
  )
})

describe('queue pagination and atomic bulk actions', () => {
  it('keeps suggestions for an unfinished taxonomy after another has human labels', async () => {
    const a = await createTaxonomy('A')
    const b = await createTaxonomy('B')
    const [record] = await createSentences(1)
    await prisma.sentenceAnnotation.create({
      data: {
        workspaceId: wsId(),
        sentenceId: record.id,
        taxonomyId: a.id,
        level: 1,
        nodeCode: '02',
        source: 'user'
      }
    })
    await prisma.sentenceAISuggestion.createMany({
      data: [a, b].map(t => ({
        workspaceId: wsId(),
        sentenceId: record.id,
        taxonomyId: t.id,
        level: 1,
        nodeCode: '02',
        confidenceScore: 0.9
      }))
    })
    const response = await queue.GET(request('/x'), params())
    expect(response.status).toBe(200)
    expect((await response.json()).sentences[0].annotations).toMatchObject([
      { source: 'user', taxonomy: { key: 'A' } },
      { source: 'ai', taxonomy: { key: 'B' } }
    ])
  })

  it('returns the last valid page when the requested page no longer exists', async () => {
    const records = await createSentences(3)
    const response = await queue.GET(request('/x?page=999999999999999999999&limit=2'), params())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pagination).toMatchObject({ page: 2, pages: 2, total: 3 })
    expect(body.sentences).toHaveLength(1)
    expect(records.map(r => r.id)).toContain(body.sentences[0].id)
  })

  it('skips the entire selection without changing labels or writing labeling activity', async () => {
    await createTaxonomy('A')
    const records = await createSentences(2)
    const response = await bulk.POST(
      request('/x', {
        method: 'POST',
        body: {
          sentenceIds: records.map(r => r.id),
          taxonomyKey: 'A',
          status: 'skipped'
        }
      }),
      params()
    )
    expect(response.status).toBe(200)
    expect((await prisma.sentence.findMany()).map(r => r.status)).toEqual(['skipped', 'skipped'])
    expect(await prisma.labelingActivity.count()).toBe(0)
  })

  it('rejects a bulk skip containing an invisible record without changing visible ones', async () => {
    await createTaxonomy('A')
    const labeller = await createUser('labeller')
    const [visible] = await createSentences(1, [labeller.id])
    const [hidden] = await createSentences(1)
    signInAs(labeller)
    const response = await bulk.POST(
      request('/x', {
        method: 'POST',
        body: {
          sentenceIds: [visible.id, hidden.id],
          taxonomyKey: 'A',
          status: 'skipped'
        }
      }),
      params()
    )
    expect(response.status).toBe(403)
    expect((await prisma.sentence.findMany()).map(r => r.status)).toEqual(['pending', 'pending'])
  })
})
