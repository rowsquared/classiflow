import { beforeAll, expect, it } from 'vitest'
import { createUser, createWorkspace, params, prisma, request, resetDatabase, signInAs } from './helpers'
import * as accounts from '@/app/api/users/route'
import * as members from '@/app/api/workspaces/[workspaceId]/users/route'
import * as member from '@/app/api/workspaces/[workspaceId]/users/[userId]/route'

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
})

it('creates one email-first global user and manages independent memberships without changing credentials', async () => {
  const actor = await createUser('admin', { platformAdmin: true })
  const other = await createWorkspace('Second workspace')
  const firstMembership = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: actor.id } })
  signInAs(actor)
  const response = await accounts.POST(
    request('/api/users', {
      method: 'POST',
      body: { email: '  Shared@Test.Local ', name: 'Shared person', tempPassword: 'a-new-strong-password-482' }
    })
  )
  expect(response.status).toBe(201)
  const { user } = await response.json()
  expect(user.email).toBe('shared@test.local')
  const credential = await prisma.account.findFirstOrThrow({ where: { userId: user.id } })
  for (const [workspaceId, role] of [
    [firstMembership.workspaceId, 'supervisor'],
    [other.id, 'labeller']
  ]) {
    const context = { params: Promise.resolve({ workspaceId: workspaceId! }) }
    const body = { existingUserId: user.id, role }
    expect((await members.POST(request('/x', { method: 'POST', body }), context)).status).toBe(201)
    expect(
      (await members.POST(request('/x', { method: 'POST', body: { ...body, role: 'admin' } }), context)).status
    ).toBe(200)
  }
  const grants = await prisma.workspaceMembership.findMany({ where: { userId: user.id } })
  expect(grants).toHaveLength(2)
  expect(grants.map(m => m.role).sort()).toEqual(['labeller', 'supervisor'])
  const target = grants.find(m => m.workspaceId === other.id)!
  const context = { params: Promise.resolve({ workspaceId: other.id, userId: user.id }) }
  expect((await member.DELETE(request('/x', { method: 'DELETE' }), context)).status).toBe(200)
  expect((await member.PUT(request('/x', { method: 'PUT', body: { status: 'active' } }), context)).status).toBe(200)
  expect((await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('active')
  expect((await prisma.account.findFirstOrThrow({ where: { userId: user.id } })).password).toBe(credential.password)
  const localAdmin = await createUser('admin')
  signInAs(localAdmin)
  expect((await accounts.GET()).status).toBe(403)
  expect(
    (await members.POST(request('/x', { method: 'POST', body: { existingUserId: user.id, role: 'admin' } }), params()))
      .status
  ).toBe(403)
})
