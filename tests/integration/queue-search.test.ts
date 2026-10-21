import { beforeAll, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import {
  createSentences,
  createUser,
  createWorkspace,
  params,
  prisma,
  request,
  resetDatabase,
  signInAs,
  wsId
} from './helpers'

import * as queueRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as statsRoute from '@/app/api/workspaces/[workspaceId]/sentences/stats/route'

// Queue text search (lib/server/sentences.ts textSearchFilter): terms of three
// or more characters go through app_search_sentences() and the trigram
// indexes; shorter ones use ILIKE directly. Both must give the same records,
// inside the caller's scope and workspace only.
let admin: User, labeller: User
let otherWorkspace: string

const texts = ['Software Engineer', 'primary school teacher', 'nurse', 'Civil ENGINEER', 'engine driver']

async function search(q: string) {
  const res = await queueRoute.GET(request(`/x?q=${encodeURIComponent(q)}&limit=100`), params())
  expect(res.status).toBe(200)
  const body = await res.json()
  return (body.sentences as Array<{ field1: string }>).map(s => s.field1).sort()
}

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  otherWorkspace = wsId()
  await createUser('admin')
  const [o] = await createSentences(1)
  await prisma.sentence.update({ where: { id: o.id }, data: { field1: 'Engineer elsewhere' } })

  await createWorkspace()
  admin = await createUser('admin')
  labeller = await createUser('labeller')
  const records = await createSentences(texts.length)
  for (const [i, record] of records.entries()) {
    await prisma.sentence.update({ where: { id: record.id }, data: { field1: texts[i]! } })
  }
  // The labeller sees only the two engineers; "nurse" also appears in field2 of the teacher.
  const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: labeller.id } })
  await prisma.sentenceAssignment.createMany({
    data: [records[0]!, records[3]!].map(r => ({ workspaceId: wsId(), sentenceId: r.id, membershipId: membership.id }))
  })
  await prisma.sentence.update({ where: { id: records[1]!.id }, data: { field2: 'night nurse' } })
})

describe('queue text search', () => {
  it('matches any field case-insensitively, through the index path and without it', async () => {
    signInAs(admin)
    expect(await search('engineer')).toEqual(['Civil ENGINEER', 'Software Engineer'])
    expect(await search('NURSE')).toEqual(['nurse', 'primary school teacher'])
    expect(await search('engine')).toEqual(['Civil ENGINEER', 'Software Engineer', 'engine driver'])
    // Two characters: the plain ILIKE path, same rules.
    expect(await search('ee')).toEqual(['Civil ENGINEER', 'Software Engineer'])
    expect(await search('UR')).toEqual(['nurse', 'primary school teacher'])
    expect(await search('zzz')).toEqual([])
  })

  it('keeps the caller scope and the workspace', async () => {
    signInAs(labeller)
    expect(await search('engine')).toEqual(['Civil ENGINEER', 'Software Engineer'])
    signInAs(admin)
    expect(await search('elsewhere')).toEqual([])
    const stats = await statsRoute.GET(request('/x/stats?q=engineer'), params())
    expect(stats.status).toBe(200)
  })

  it('finds nothing outside a workspace transaction', async () => {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM app_search_sentences('engineer', 10)`
    expect(rows).toEqual([])
    expect(otherWorkspace).not.toBe(wsId())
  })
})
