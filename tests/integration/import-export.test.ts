import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { parse } from 'csv-parse/sync'
import type { User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createSentences, createUser, params, request, resetDatabase, signInAs } from './helpers'

import * as taxonomiesRoute from '@/app/api/taxonomies/route'
import * as taxonomyRoute from '@/app/api/taxonomies/[key]/route'
import * as validateRoute from '@/app/api/taxonomies/validate/route'
import * as incrementalRoute from '@/app/api/taxonomies/[key]/import/route'
import * as recordImportRoute from '@/app/api/sentences/import/route'
import * as exportRoute from '@/app/api/export/route'

let admin: User

beforeEach(async () => {
  await resetDatabase()
  admin = await createUser('admin')
  signInAs(admin)
})

function multipart(url: string, method: string, fields: Record<string, string>, csv?: string, fileName = 'data.csv') {
  const form = new FormData()
  Object.entries(fields).forEach(([k, v]) => form.append(k, v))
  if (csv !== undefined) form.append('file', new File([csv], fileName, { type: 'text/csv' }))
  return new NextRequest(new URL(url, 'http://localhost:3000'), { method, body: form })
}

const TREE = 'id,label,parent_id,level,synonyms\n01,Group,,1,"a, b"\n011,Item 011,01,2,\n012,Item 012,01,2,\n02,Other,,1,\n'

async function createTaxonomy(key = 'occ', csv = TREE) {
  return taxonomiesRoute.POST(multipart('/api/taxonomies', 'POST', { key, maxDepth: '2' }, csv))
}

describe('taxonomy CSV lifecycle', () => {
  it('validate and create agree, keep leading zeros and set leaves', async () => {
    const bad = 'id,label,parent_id,level\n01,A,,1\n011,B,01,3\n'
    const v = await validateRoute.POST(multipart('/api/taxonomies/validate', 'POST', {}, bad))
    expect(v.status).toBe(400)
    expect((await createTaxonomy('bad', bad)).status).toBe(400)
    expect(await prisma.taxonomy.count()).toBe(0)

    expect((await validateRoute.POST(multipart('/x', 'POST', {}, TREE))).status).toBe(200)
    const res = await createTaxonomy()
    expect(res.status).toBe(200)
    const nodes = await prisma.taxonomyNode.findMany({ orderBy: { code: 'asc' } })
    expect(nodes.map(n => [n.code, n.isLeaf, n.path])).toEqual([
      ['01', false, '01'], ['011', true, '01.011'], ['012', true, '01.012'], ['02', true, '02'],
    ])
    expect(await prisma.taxonomySynonym.count()).toBe(2)
  })

  it('rejects unsafe taxonomy keys', async () => {
    expect((await createTaxonomy('bad key,1')).status).toBe(400)
  })

  it('replacing nodes that labels still use needs confirmation', async () => {
    await createTaxonomy()
    const taxonomy = await prisma.taxonomy.findUniqueOrThrow({ where: { key: 'occ' } })
    const [r] = await createSentences(1)
    await prisma.sentenceAnnotation.createMany({ data: [
      { sentenceId: r.id, taxonomyId: taxonomy.id, level: 1, nodeCode: '01', source: 'user' },
      { sentenceId: r.id, taxonomyId: taxonomy.id, level: 2, nodeCode: '012', source: 'user' },
    ] })

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
    const add = (csv: string, dry: boolean) => incrementalRoute.POST(
      new NextRequest(new URL(`/api/taxonomies/occ/import?dryRun=${dry}`, 'http://localhost:3000'), {
        method: 'POST', body: csv, headers: { 'content-type': 'text/csv' },
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
    const taxonomy = await prisma.taxonomy.findUniqueOrThrow({ where: { key: 'occ' } })
    const job = await prisma.aILearningJob.create({
      data: { taxonomyId: taxonomy.id, createdById: admin.id, status: 'processing', totalSentences: 1 },
    })
    const del = () => taxonomyRoute.DELETE(request('/api/taxonomies/occ', { method: 'DELETE' }), params({ key: 'occ' }))
    expect((await del()).status).toBe(409)

    await prisma.aILearningJob.update({ where: { id: job.id }, data: { status: 'completed' } })
    expect((await del()).status).toBe(200)
    expect(await prisma.taxonomy.count()).toBe(0)
    expect(await prisma.aILearningJob.count()).toBe(0)
  })
})

describe('record import and export', () => {
  it('dry run and commit agree; ids keep leading zeros; uploader recorded', async () => {
    const csv = 'id,field_title,support_region\n007,"Baker, ""head""",=SUM(1)\n008,Clerk,North\n'
    const dry = await recordImportRoute.POST(multipart('/api/sentences/import?dryRun=true', 'POST', {}, csv))
    expect(dry.status).toBe(200)
    expect(await prisma.sentence.count()).toBe(0)

    const commit = await recordImportRoute.POST(multipart('/api/sentences/import?dryRun=false', 'POST', {}, csv))
    expect(commit.status).toBe(200)
    expect((await prisma.sentence.findMany({ orderBy: { id: 'asc' } })).map(s => s.id)).toEqual(['007', '008'])
    expect((await prisma.sentenceImport.findFirstOrThrow()).uploadedById).toBe(admin.id)

    const again = await recordImportRoute.POST(multipart('/api/sentences/import?dryRun=false', 'POST', {}, csv))
    expect(again.status).toBe(400) // ids already exist

    const dupCols = await recordImportRoute.POST(multipart('/x?dryRun=true', 'POST', {}, 'field_a,field_a\n1,2\n'))
    expect(dupCols.status).toBe(400)
  })

  it('export escapes every cell and neutralises formulas only in text columns', async () => {
    await createTaxonomy()
    const taxonomy = await prisma.taxonomy.findUniqueOrThrow({ where: { key: 'occ' } })
    await recordImportRoute.POST(multipart('/api/sentences/import?dryRun=false', 'POST', {},
      'id,field_title,support_region\n007,"Baker, ""head""\nline 2",=SUM(1)\n'))
    await prisma.sentenceAnnotation.createMany({ data: [
      { sentenceId: '007', taxonomyId: taxonomy.id, level: 1, nodeCode: '01', source: 'user' },
      { sentenceId: '007', taxonomyId: taxonomy.id, level: 2, nodeCode: '-99', source: 'user' },
    ] })
    await prisma.comment.create({ data: { sentenceId: '007', authorId: admin.id, body: '+1 "agree", see row' } })

    const res = await exportRoute.GET(request('/api/export'))
    expect(res.status).toBe(200)
    const [header, row] = parse(await res.text()) as string[][]
    const cell = (name: string) => row[header.indexOf(name)]
    expect(cell('id')).toBe('007')
    expect(cell('field_title')).toBe('Baker, "head"\nline 2')
    expect(cell('support_region')).toBe(`'=SUM(1)`)
    expect(cell('occ_1')).toBe('01')
    expect(cell('occ_2')).toBe('UNKNOWN')
    expect(cell('comments')).toBe(`[${admin.name}]: +1 "agree", see row`)

    const raw = await exportRoute.GET(request('/api/export?formulaSafe=false'))
    const [h2, r2] = parse(await raw.text()) as string[][]
    expect(r2[h2.indexOf('support_region')]).toBe('=SUM(1)')
  })
})
