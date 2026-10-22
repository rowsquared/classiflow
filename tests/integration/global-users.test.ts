import { beforeAll, expect, it } from 'vitest'
import { createUser, createWorkspace, params, prisma, request, resetDatabase, signInAs } from './helpers'
import * as accounts from '@/app/api/users/route'
import * as users from '@/app/api/users/[userId]/route'
import * as workspaces from '@/app/api/workspaces/route'
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
  expect((await accounts.GET(request('/api/users'))).status).toBe(403)
  expect(
    (await members.POST(request('/x', { method: 'POST', body: { existingUserId: user.id, role: 'admin' } }), params()))
      .status
  ).toBe(403)
})

it('filters and pages the global directory in the database', async () => {
  const home = await createWorkspace('Directory home')
  const actor = await createUser('labeller', { platformAdmin: true })
  const supervisorUser = await createUser('supervisor')
  const disabled = await createUser('labeller')
  await prisma.user.update({ where: { id: disabled.id }, data: { banned: true, name: 'Zed Disabled' } })
  const loose = await prisma.user.create({
    data: { username: 'loose-person', email: 'loose@test.local', name: 'Loose' }
  })
  signInAs(actor)
  const list = async (query: string) => {
    const response = await accounts.GET(request(`/api/users?${query}`))
    expect(response.status).toBe(200)
    return (await response.json()) as { users: Array<{ id: string }>; total: number; page: number; pageSize: number }
  }
  const ids = (page: { users: Array<{ id: string }> }) => page.users.map(u => u.id)

  expect(ids(await list('workspace=none'))).toContain(loose.id)
  expect(ids(await list('workspace=none'))).not.toContain(actor.id)
  const inHome = ids(await list(`workspace=${home.id}`))
  expect(inHome).toEqual(expect.arrayContaining([actor.id, supervisorUser.id, disabled.id]))
  expect(inHome).not.toContain(loose.id)
  expect(ids(await list(`workspace=${home.id}&role=supervisor`))).toEqual([supervisorUser.id])
  expect(ids(await list('role=platform_admin'))).toContain(actor.id)
  expect(ids(await list('role=platform_admin'))).not.toContain(supervisorUser.id)
  expect(ids(await list('state=disabled'))).toEqual([disabled.id])
  expect(ids(await list('q=LOOSE@test'))).toEqual([loose.id])

  const all = await list('pageSize=100')
  const first = await list('pageSize=2&page=1')
  const second = await list('pageSize=2&page=2')
  expect(first.total).toBe(all.total)
  expect([...ids(first), ...ids(second)]).toEqual(ids(all).slice(0, 4))
  expect((await accounts.GET(request('/api/users?pageSize=1000'))).status).toBe(400)

  const one = await users.GET(request(`/api/users/${loose.id}`), { params: Promise.resolve({ userId: loose.id }) })
  expect((await one.json()).user).toMatchObject({ id: loose.id, platformRole: 'user', memberships: [] })

  // An existing email opens that account instead of creating another.
  const duplicate = await accounts.POST(
    request('/api/users', {
      method: 'POST',
      body: { email: 'LOOSE@test.local', name: 'Again', tempPassword: 'a-new-strong-password-482' }
    })
  )
  expect(duplicate.status).toBe(409)
  expect(await duplicate.json()).toMatchObject({ existingUserId: loose.id })
})

it('creates a workspace with a chosen first admin, never a disabled one', async () => {
  const actor = await createUser('labeller', { platformAdmin: true })
  const chosen = await prisma.user.create({
    data: { username: 'first-admin', email: 'first@test.local', name: 'First' }
  })
  const disabled = await prisma.user.create({
    data: { username: 'off-admin', email: 'off@test.local', name: 'Off', banned: true }
  })
  signInAs(actor)
  const create = (adminUserId: string) =>
    workspaces.POST(request('/api/workspaces', { method: 'POST', body: { name: `WS ${adminUserId}`, adminUserId } }))
  const response = await create(chosen.id)
  expect(response.status).toBe(201)
  const { workspace } = await response.json()
  const memberships = await prisma.workspaceMembership.findMany({ where: { workspaceId: workspace.id } })
  expect(memberships.map(m => [m.userId, m.role])).toEqual([[chosen.id, 'admin']])
  expect((await create(disabled.id)).status).toBe(400)
})
