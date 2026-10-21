import { beforeAll, describe, expect, it } from 'vitest'
import type { Sentence, Taxonomy, User, Workspace } from '@/lib/generated/prisma/client'
import { setWorkspaceStatus } from '@/lib/server/workspaces'
import {
  createSentences, createTaxonomy, createUser, createWorkspace, prisma, request, resetDatabase, signInAs, selectWorkspace,
} from './helpers'

import * as queueRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as detailRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/route'
import * as bulkRoute from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'
import * as commentsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/comments/route'
import * as taxonomiesRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/active/route'
import * as auditRoute from '@/app/api/workspaces/[workspaceId]/audit/route'

// Two workspaces with the same taxonomy key; one person (shared) is admin in
// A and labeller in B; platform admin belongs to neither.
let a: Workspace, b: Workspace
let adminA: User, adminB: User, shared: User, platform: User
let recordA: Sentence, recordB: Sentence
let taxA: Taxonomy, taxB: Taxonomy

const ctx = (workspace: Workspace, extra: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ workspaceId: workspace.id, ...extra }) })

beforeAll(async () => {
  await resetDatabase()
  a = await createWorkspace('A')
  adminA = await createUser('admin')
  shared = await createUser('admin')
  ;[recordA] = await createSentences(1, [shared.id])
  taxA = await createTaxonomy('isco')

  b = await createWorkspace('B')
  adminB = await createUser('admin')
  await prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: shared.id, role: 'labeller' } })
  ;[recordB] = await createSentences(1, [shared.id])
  taxB = await createTaxonomy('isco')

  selectWorkspace(a.id)
  platform = await createUser('labeller', { platformAdmin: true, workspaceId: b.id })
  await prisma.workspaceMembership.deleteMany({ where: { userId: platform.id } })
})

describe('workspace isolation', () => {
  it('allows the same taxonomy key in two workspaces', () => {
    expect(taxA.key).toBe(taxB.key)
    expect(taxA.id).not.toBe(taxB.id)
  })

  it('hides a workspace from non-members (404, not 403)', async () => {
    signInAs(adminB)
    const res = await queueRoute.GET(request('/x'), ctx(a))
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('A')
  })

  it('lists only the workspace\'s own records and taxonomies', async () => {
    signInAs(adminA)
    const queue = await (await queueRoute.GET(request('/x'), ctx(a))).json()
    expect(queue.sentences.map((s: { id: string }) => s.id)).toEqual([recordA.id])
    const taxonomies = await (await taxonomiesRoute.GET(request('/x'), ctx(a))).json()
    expect(taxonomies.taxonomies.map((t: { id: string }) => t.id)).toEqual([taxA.id])
  })

  it('refuses another workspace\'s record id even to that workspace\'s admin', async () => {
    signInAs(adminA)
    expect((await detailRoute.GET(request('/x'), ctx(a, { sentenceId: recordB.id }))).status).toBe(403)
    const res = await commentsRoute.POST(
      request('/x', { method: 'POST', body: { body: 'sneaky' } }), ctx(a, { sentenceId: recordB.id }))
    expect(res.status).toBe(403)
    expect(await prisma.comment.count()).toBe(0)
  })

  it('refuses a bulk request that mixes workspaces as a whole', async () => {
    signInAs(adminA)
    const res = await bulkRoute.POST(request('/x', {
      method: 'POST',
      body: { sentenceIds: [recordA.id, recordB.id], taxonomyKey: 'isco', annotations: [{ level: 1, nodeCode: '02' }] },
    }), ctx(a))
    expect(res.status).toBe(403)
    expect(await prisma.sentenceAnnotation.count()).toBe(0)
  })

  it('gives one person different roles in different workspaces', async () => {
    signInAs(shared)
    // Admin in A: sees every record there.
    expect((await queueRoute.GET(request('/x'), ctx(a))).status).toBe(200)
    expect((await auditRoute.GET(request('/x'), ctx(a))).status).toBe(200)
    // Labeller in B: admin-only APIs are refused there.
    expect((await auditRoute.GET(request('/x'), ctx(b))).status).toBe(403)
  })

  it('lets platform admins enter every workspace as admin', async () => {
    signInAs(platform)
    for (const workspace of [a, b]) {
      expect((await queueRoute.GET(request('/x'), ctx(workspace))).status).toBe(200)
    }
  })

  it('makes an archived workspace read-only', async () => {
    await setWorkspaceStatus(b.id, 'archived')
    signInAs(adminB)
    expect((await queueRoute.GET(request('/x'), ctx(b))).status).toBe(200)
    const res = await commentsRoute.POST(
      request('/x', { method: 'POST', body: { body: 'late' } }), ctx(b, { sentenceId: recordB.id }))
    expect(res.status).toBe(409)
    await setWorkspaceStatus(b.id, 'active')
  })
})
