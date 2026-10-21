import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { parse } from 'csv-parse/sync'
import type { User } from '@/lib/generated/prisma/client'
import { db } from '@/lib/workspace/db'
import {
  prisma,
  wsId,
  inWorkspace,
  createAIConnection,
  createWorkspace,
  createSentences,
  createUser,
  params,
  request,
  resetDatabase,
  signInAs
} from './helpers'

import * as taxonomiesRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/route'
import * as taxonomyRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/[key]/route'
import * as validateRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/validate/route'
import * as incrementalRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/[key]/import/route'
import * as recordImportRoute from '@/app/api/workspaces/[workspaceId]/sentences/import/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'

let admin: User

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  await createWorkspace()
  await createWorkspace()
  admin = await createUser('admin')
  signInAs(admin)
})

function multipart(url: string, method: string, fields: Record<string, string>, csv?: string, fileName = 'data.csv') {
  const form = new FormData()
  Object.entries(fields).forEach(([k, v]) => form.append(k, v))
  if (csv !== undefined) form.append('file', new File([csv], fileName, { type: 'text/csv' }))
  return new NextRequest(new URL(url, 'http://localhost:3000'), { method, body: form })
}

const TREE =
  'id,label,parent_id,level,synonyms\n01,Group,,1,"a, b"\n011,Item 011,01,2,\n012,Item 012,01,2,\n02,Other,,1,\n'

async function createTaxonomy(key = 'occ', csv = TREE) {
  return taxonomiesRoute.POST(multipart('/api/taxonomies', 'POST', { key, maxDepth: '2' }, csv), params())
}

describe('taxonomy CSV lifecycle', () => {
  it('validate and create agree, keep leading zeros and set leaves', async () => {
    const bad = 'id,label,parent_id,level\n01,A,,1\n011,B,01,3\n'
    const v = await validateRoute.POST(multipart('/api/taxonomies/validate', 'POST', {}, bad), params())
    expect(v.status).toBe(400)
    expect((await createTaxonomy('bad', bad)).status).toBe(400)
    expect(await prisma.taxonomy.count()).toBe(0)

    expect((await validateRoute.POST(multipart('/x', 'POST', {}, TREE), params())).status).toBe(200)
    const res = await createTaxonomy()
    expect(res.status).toBe(200)
    const nodes = await prisma.taxonomyNode.findMany({ orderBy: { code: 'asc' } })
    expect(nodes.map(n => [n.code, n.isLeaf, n.path])).toEqual([
      ['01', false, '01'],
      ['011', true, '01.011'],
      ['012', true, '01.012'],
      ['02', true, '02']
    ])
    expect(await prisma.taxonomySynonym.count()).toBe(2)
  })

  it('rejects unsafe taxonomy keys', async () => {
    expect((await createTaxonomy('bad key,1')).status).toBe(400)
  })

  it('replacing nodes that labels still use needs confirmation', async () => {
    await createTaxonomy()
    const taxonomy = await prisma.taxonomy.findFirstOrThrow({ where: { key: 'occ' } })
    const [r] = await createSentences(1)
    await inWorkspace(() =>
      db().sentenceAnnotation.createMany({
        data: [
          { workspaceId: wsId(), sentenceId: r.id, taxonomyId: taxonomy.id, level: 1, nodeCode: '01', source: 'user' },
          { workspaceId: wsId(), sentenceId: r.id, taxonomyId: taxonomy.id, level: 2, nodeCode: '012', source: 'user' }
        ]
      })
    )

    const smaller = 'id,label,parent_id,level\n01,Group,,1\n011,Item,01,2\n'
    const put = (extra: Record<string, string>) =>
      taxonomyRoute.PUT(multipart('/api/taxonomies/occ', 'PUT', extra, smaller), params({ key: 'occ' }))

    const refused = await put({})
    expect(refused.status).toBe(409)
    expect((await refused.json()).orphanedLabels).toBe(1)
    expect(await prisma.taxonomyNode.count()).toBe(4)

    expect((await put({ confirmOrphans: 'true' })).status).toBe(200)
    expect(await prisma.taxonomyNode.count()).toBe(2)
  })

  it('incremental import adds under existing parents and updates leaves', async () => {
    await createTaxonomy()
    const add = (csv: string, dry: boolean) =>
      incrementalRoute.POST(
        new NextRequest(new URL(`/api/taxonomies/occ/import?dryRun=${dry}`, 'http://localhost:3000'), {
          method: 'POST',
          body: csv,
          headers: { 'content-type': 'text/csv' }
        }),
        params({ key: 'occ' })
      )
    expect((await add('id,label,parent_id,level\n021,New,02,2\n', true)).status).toBe(200)
    expect(await prisma.taxonomyNode.count()).toBe(4)
    expect((await add('id,label,parent_id,level\n021,New,02,2\n', false)).status).toBe(200)
    expect((await prisma.taxonomyNode.findFirstOrThrow({ where: { code: '02' } })).isLeaf).toBe(false)
    expect((await add('id,label,parent_id,level\n01,Dup,,1\n', false)).status).toBe(400)
  })

  it('deletes a taxonomy with finished learning jobs, refuses while one runs', async () => {
    await createTaxonomy()
    const taxonomy = await prisma.taxonomy.findFirstOrThrow({ where: { key: 'occ' } })
    const connection = await createAIConnection()
    const job = await inWorkspace(() =>
      db().aILearningJob.create({
        data: {
          workspaceId: wsId(),
          taxonomyId: taxonomy.id,
          createdById: admin.id,
          connectionVersionId: connection.id,
          status: 'processing',
          totalSentences: 1
        }
      })
    )
    const del = () => taxonomyRoute.DELETE(request('/api/taxonomies/occ', { method: 'DELETE' }), params({ key: 'occ' }))
    expect((await del()).status).toBe(409)

    await inWorkspace(() => db().aILearningJob.update({ where: { id: job.id }, data: { status: 'completed' } }))
    expect((await del()).status).toBe(200)
    expect(await prisma.taxonomy.count()).toBe(0)
    expect(await prisma.aILearningJob.count()).toBe(0)
  })
})

describe('record import and export', () => {
  it('dry run and commit agree; ids keep leading zeros; uploader recorded', async () => {
    const csv = 'id,field_title,support_region\n007,"Baker, ""head""",=SUM(1)\n008,Clerk,North\n'
    const dry = await recordImportRoute.POST(multipart('/api/sentences/import?dryRun=true', 'POST', {}, csv), params())
    expect(dry.status).toBe(200)
    expect(await prisma.sentence.count()).toBe(0)

    const commit = await recordImportRoute.POST(
      multipart('/api/sentences/import?dryRun=false', 'POST', {}, csv),
      params()
    )
    expect(commit.status).toBe(200)
    expect((await prisma.sentence.findMany({ orderBy: { recordKey: 'asc' } })).map(s => s.recordKey)).toEqual([
      '007',
      '008'
    ])
    expect((await prisma.sentenceImport.findFirstOrThrow()).uploadedById).toBe(admin.id)

    const again = await recordImportRoute.POST(
      multipart('/api/sentences/import?dryRun=false', 'POST', {}, csv),
      params()
    )
    expect(again.status).toBe(400) // ids already exist

    const dupCols = await recordImportRoute.POST(
      multipart('/x?dryRun=true', 'POST', {}, 'field_a,field_a\n1,2\n'),
      params()
    )
    expect(dupCols.status).toBe(400)
  })

  it('export escapes every cell and neutralises formulas only in text columns', async () => {
    await createTaxonomy()
    const taxonomy = await prisma.taxonomy.findFirstOrThrow({ where: { key: 'occ' } })
    await recordImportRoute.POST(
      multipart(
        '/api/sentences/import?dryRun=false',
        'POST',
        {},
        'id,field_title,support_region\n007,"Baker, ""head""\nline 2",=SUM(1)\n'
      ),
      params()
    )
    // The CSV id is the record key; labels and comments refer to the internal id.
    const { id: recordId } = await prisma.sentence.findFirstOrThrow({ where: { recordKey: '007' } })
    await inWorkspace(() =>
      db().sentenceAnnotation.createMany({
        data: [
          {
            workspaceId: wsId(),
            sentenceId: recordId,
            taxonomyId: taxonomy.id,
            level: 1,
            nodeCode: '01',
            source: 'user'
          },
          {
            workspaceId: wsId(),
            sentenceId: recordId,
            taxonomyId: taxonomy.id,
            level: 2,
            nodeCode: '-99',
            source: 'user'
          }
        ]
      })
    )
    await inWorkspace(() =>
      db().comment.create({
        data: { workspaceId: wsId(), sentenceId: recordId, authorId: admin.id, body: '+1 "agree", see row' }
      })
    )

    const res = await exportRoute.GET(request('/api/export'), params())
    expect(res.status).toBe(200)
    const [header, row] = parse(await res.text()) as [string[], string[]]
    const cell = (name: string) => row[header.indexOf(name)]
    expect(cell('id')).toBe('007')
    expect(cell('field_title')).toBe('Baker, "head"\nline 2')
    expect(cell('support_region')).toBe(`'=SUM(1)`)
    expect(cell('occ_1')).toBe('01')
    expect(cell('occ_2')).toBe('UNKNOWN')
    expect(cell('comments')).toBe(`[${admin.name}]: +1 "agree", see row`)

    const raw = await exportRoute.GET(request('/api/export?formulaSafe=false'), params())
    const [h2, r2] = parse(await raw.text()) as [string[], string[]]
    expect(r2[h2.indexOf('support_region')]).toBe('=SUM(1)')
  })

  it('exports large sets completely, in import order, with columns from every import', async () => {
    const a = await inWorkspace(() => db().taxonomy.create({ data: { workspaceId: wsId(), key: 'zeta', maxDepth: 1 } }))
    const b = await inWorkspace(() =>
      db().taxonomy.create({ data: { workspaceId: wsId(), key: 'alpha', maxDepth: 2 } })
    )
    const first = await inWorkspace(() =>
      db().sentenceImport.create({ data: { workspaceId: wsId(), fileName: 'a.csv', totalRows: 1300 } })
    )
    const second = await inWorkspace(() =>
      db().sentenceImport.create({ data: { workspaceId: wsId(), fileName: 'b.csv', totalRows: 1200 } })
    )
    const pad = (n: number) => String(n).padStart(5, '0')
    await inWorkspace(() =>
      db().sentence.createMany({
        data: Array.from({ length: 1300 }, (_, i) => ({
          workspaceId: wsId(),
          recordKey: `a${pad(i)}`,
          id: `a${pad(i)}`,
          importId: first.id,
          importOrder: 1299 - i,
          field1: `title ${i}`,
          fieldMapping: { '1': 'title' }
        }))
      })
    )
    await inWorkspace(() =>
      db().sentence.createMany({
        data: Array.from({ length: 1200 }, (_, i) => ({
          workspaceId: wsId(),
          recordKey: `b${pad(i)}`,
          id: `b${pad(i)}`,
          importId: second.id,
          importOrder: i,
          field1: `desc ${i}`,
          support1: `r${i}`,
          fieldMapping: { '1': 'description' },
          supportMapping: { '1': 'region' }
        }))
      })
    )
    await inWorkspace(() =>
      db().sentenceAnnotation.create({
        data: { workspaceId: wsId(), sentenceId: 'b00005', taxonomyId: a.id, level: 1, nodeCode: '007', source: 'user' }
      })
    )
    await inWorkspace(() =>
      db().sentenceAISuggestion.create({
        data: {
          workspaceId: wsId(),
          sentenceId: 'a00000',
          taxonomyId: b.id,
          level: 2,
          nodeCode: '0110',
          confidenceScore: 0.5
        }
      })
    )

    const res = await exportRoute.GET(request('/api/export'), params())
    expect(res.status).toBe(200)
    const [header, ...rows] = parse(await res.text()) as [string[], ...string[][]]

    expect(header).toEqual([
      'id',
      'field_title',
      'field_description',
      'support_region',
      'alpha_1',
      'alpha_2',
      'zeta_1',
      'alpha_ai1',
      'alpha_ai1c',
      'alpha_ai2',
      'alpha_ai2c',
      'zeta_ai1',
      'zeta_ai1c',
      'status',
      'flagged',
      'last_editor',
      'last_edited',
      'comments'
    ])
    expect(rows).toHaveLength(2500)
    const importIds = new Map([
      [first.id, 'a'],
      [second.id, 'b']
    ])
    const expectedOrder = [...importIds.keys()]
      .sort()
      .flatMap(id =>
        importIds.get(id) === 'a'
          ? Array.from({ length: 1300 }, (_, k) => `a${pad(1299 - k)}`)
          : Array.from({ length: 1200 }, (_, k) => `b${pad(k)}`)
      )
    expect(rows.map(r => r[0])).toEqual(expectedOrder)
    const row = (id: string) => rows.find(r => r[0] === id)!
    const cell = (id: string, name: string) => row(id)[header.indexOf(name)]
    expect(cell('b00005', 'zeta_1')).toBe('007')
    expect(cell('b00005', 'field_description')).toBe('desc 5')
    expect(cell('b00005', 'field_title')).toBe('')
    expect(cell('a00000', 'alpha_ai2')).toBe('0110')
    expect(cell('a00000', 'alpha_ai2c')).toBe('0.5000')
  })
})
