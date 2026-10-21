import { beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { prisma, plainParams, createWorkspace, createSentences, createTaxonomy, createUser, params, request, resetDatabase, signInAs } from './helpers'

import * as usersRoute from '@/app/api/workspaces/[workspaceId]/users/route'
import * as userRoute from '@/app/api/workspaces/[workspaceId]/users/[userId]/route'
import * as accountRoute from '@/app/api/users/[userId]/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'
import * as assignRoute from '@/app/api/workspaces/[workspaceId]/sentences/assign/route'
import * as annotationsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/annotations/route'
import * as auditRoute from '@/app/api/workspaces/[workspaceId]/audit/route'

let admin: User

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  await createWorkspace()
  admin = await createUser('admin', { platformAdmin: true })
  signInAs(admin)
})

const entries = (action?: string) =>
  prisma.auditLog.findMany({ where: action ? { action } : {}, orderBy: { createdAt: 'asc' } })

let created = 0
async function createViaApi(role = 'labeller') {
  const n = ++created
  const res = await usersRoute.POST(request('/api/users', {
    method: 'POST',
    body: { username: `audit${n}`, email: `audit${n}@test.local`, name: 'U', role, tempPassword: 'temporary-pass-1' },
  }), params())
  expect(res.status).toBe(201)
  return (await res.json()).user as { id: string }
}

describe('audit trail', () => {
  it('records user creation, role change and admin password reset without secrets', async () => {
    const created = await createViaApi()
    const res = await userRoute.PUT(
      request(`/api/users/${created.id}`, { method: 'PUT', body: { role: 'supervisor', newPassword: 'another-pass-123' } }),
      params({ userId: created.id }))
    expect(res.status).toBe(200)

    const [create] = await entries('user.created')
    expect(create).toMatchObject({ actorId: admin.id, actorName: admin.username, entityType: 'user', entityId: created.id })
    const [update] = await entries('member.updated')
    expect(update.payload).toMatchObject({ role: { from: 'labeller', to: 'supervisor' }, passwordReset: true })
    const all = JSON.stringify(await entries())
    expect(all).not.toContain('temporary-pass-1')
    expect(all).not.toContain('another-pass-123')
    expect(all).not.toContain('$2') // no bcrypt hash
  })

  it('keeps the actor\'s name after the actor is deleted', async () => {
    const otherAdmin = await createUser('admin')
    signInAs(otherAdmin)
    const created = await createViaApi()
    signInAs(admin)
    expect((await accountRoute.DELETE(request(`/api/users/${otherAdmin.id}`, { method: 'DELETE' }), plainParams({ userId: otherAdmin.id }))).status).toBe(200)

    const [create] = await entries('user.created')
    expect(create).toMatchObject({ actorId: null, actorName: otherAdmin.username, entityId: created.id })
    const [deleted] = await entries('user.deleted')
    expect(deleted).toMatchObject({ actorId: admin.id, entityId: otherAdmin.id })
  })

  it('records refused access by role and by record scope', async () => {
    const labeller = await createUser('labeller')
    const [notMine] = await createSentences(1)
    await createTaxonomy('A')
    signInAs(labeller)

    expect((await exportRoute.GET(request('/api/export'), params())).status).toBe(403)
    const save = await annotationsRoute.POST(
      request(`/api/sentences/${notMine.id}/annotations`, { method: 'POST', body: { annotations: [], status: 'pending' } }),
      params({ sentenceId: notMine.id }))
    expect(save.status).toBe(403)

    const denied = await entries('access.denied')
    expect(denied.map(d => [d.actorId, d.entityType, (d.payload as { reason: string }).reason])).toEqual([
      [labeller.id, 'role', 'role'],
      [labeller.id, 'sentence', 'record scope'],
    ])
  })

  it('records exports and assignment changes with counts, not record contents', async () => {
    const labeller = await createUser('labeller')
    const records = await createSentences(2)
    expect((await assignRoute.POST(request('/api/sentences/assign', {
      method: 'POST', body: { sentenceIds: records.map(r => r.id), userIds: [labeller.id] },
    }), params())).status).toBe(200)
    const download = await exportRoute.GET(request('/api/export'), params())
    expect(download.status).toBe(200)
    await download.text() // recorded once the whole file was sent

    const [assigned] = await entries('assignments.added')
    expect(assigned.payload).toEqual({ records: 2, userIds: [labeller.id] })
    const [exported] = await entries('export.downloaded')
    expect(exported.payload).toMatchObject({ records: 2, status: 'all' })
    expect(JSON.stringify(await entries())).not.toContain('record 0')
  })

  it('lists entries to admins only, newest first, with prefix filter and paging', async () => {
    for (let i = 0; i < 3; i++) await createViaApi()
    await (await exportRoute.GET(request('/api/export'), params())).text()

    const first = await (await auditRoute.GET(request('/api/audit?action=user.&limit=2'), params())).json()
    expect(first.entries).toHaveLength(2)
    expect(first.entries.every((e: { action: string }) => e.action === 'user.created')).toBe(true)
    const second = await (await auditRoute.GET(request(`/api/audit?action=user.&limit=2&cursor=${first.nextCursor}`), params())).json()
    expect(second.entries).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.entries, ...second.entries].map((e: { id: string }) => e.id)
    expect(new Set(ids).size).toBe(3)

    signInAs(await createUser('supervisor'))
    expect((await auditRoute.GET(request('/api/audit'), params())).status).toBe(403)
  })
})
