import { beforeEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import {
  createAIConnection,
  createSentences,
  createTaxonomy,
  createUser,
  createWorkspace,
  plainParams,
  prisma,
  request,
  resetDatabase,
  selectWorkspace,
  signInAs
} from './helpers'
import * as directory from '@/app/api/user-directory/route'
import * as detail from '@/app/api/user-directory/[userId]/route'
import * as exportRoute from '@/app/api/user-directory/export/route'
import * as lifecycle from '@/app/api/workspaces/[workspaceId]/route'
import * as preview from '@/app/api/workspaces/[workspaceId]/deletion-preview/route'
import * as users from '@/app/api/users/[userId]/route'
import { WORKSPACE_DELETE_TABLES, setWorkspaceStatus } from '@/lib/server/workspaces'

vi.hoisted(() => {
  process.env.AI_CREDENTIALS_KEYS = 'test:W2yqrU25xVWcv6H1lvt11YmB5W8aFNzjyXGwGQJpp1Q='
})

beforeEach(resetDatabase)
const ctx = (workspaceId: string) => plainParams({ workspaceId })

it('sorts the active team count rather than counting removed reports', async () => {
  const ws = await createWorkspace()
  const admin = await createUser('admin')
  const former = await createUser('supervisor')
  const current = await createUser('supervisor')
  const one = await createUser('labeller', { supervisorId: former.id })
  const two = await createUser('labeller', { supervisorId: former.id })
  await createUser('labeller', { supervisorId: current.id })
  await prisma.workspaceMembership.updateMany({
    where: { userId: { in: [one.id, two.id] } },
    data: { status: 'suspended' }
  })
  signInAs(admin)
  const result = await (
    await directory.GET(request(`/x?workspace=${ws.id}&role=supervisor&sort=team&direction=desc&pageSize=1`))
  ).json()
  expect(result.users.map((u: { id: string }) => u.id)).toEqual([current.id])
  expect(result.users[0].memberships[0]._count.reports).toBe(1)
})

it('can cancel external jobs after deleting their stored connection', async () => {
  const ws = await createWorkspace('External cancellation')
  const actor = await createUser('admin', { platformAdmin: true })
  const taxonomy = await createTaxonomy()
  const calls: Array<{ path: string | undefined; connectionGone: boolean }> = []
  const server = createServer(async (req, res) => {
    calls.push({
      path: req.url,
      connectionGone: (await prisma.aIConnectionVersion.count({ where: { workspaceId: ws.id } })) === 0
    })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No stub address')
    const connection = await createAIConnection({
      baseUrl: `http://127.0.0.1:${address.port}`,
      credential: 'test-only-cancellation-token'
    })
    await prisma.aILabelingJob.create({
      data: {
        workspaceId: ws.id,
        taxonomyId: taxonomy.id,
        createdById: actor.id,
        totalSentences: 0,
        connectionVersionId: connection.id,
        status: 'cancelled',
        externalJobId: 'external-job'
      }
    })
    await prisma.workspace.update({ where: { id: ws.id }, data: { status: 'archived' } })
    signInAs(actor)
    const response = await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ path: '/label/external-job/cancel', connectionGone: true }])
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
})

it('rolls back every deletion when the final workspace delete fails', async () => {
  const ws = await createWorkspace('Rollback deletion')
  const actor = await createUser('admin', { platformAdmin: true })
  await createSentences(1)
  await setWorkspaceStatus(ws.id, 'archived')
  signInAs(actor)
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION test_refuse_workspace_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test deletion failure'; END $$`
  )
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER test_refuse_workspace_delete BEFORE DELETE ON "Workspace" FOR EACH ROW EXECUTE FUNCTION test_refuse_workspace_delete()`
  )
  try {
    expect(
      (await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))).status
    ).toBe(500)
    expect(await prisma.sentence.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'workspace.deleted', entityId: ws.id } })).toBe(0)
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER test_refuse_workspace_delete ON "Workspace"')
    await prisma.$executeRawUnsafe('DROP FUNCTION test_refuse_workspace_delete()')
  }
})

it('scopes the directory, detail, chips, total and export to administered workspaces, including removed memberships', async () => {
  const a = await createWorkspace('Managed A')
  const admin = await createUser('admin')
  const shared = await createUser('labeller')
  const removed = await createUser('labeller')
  await prisma.workspaceMembership.updateMany({ where: { userId: removed.id }, data: { status: 'suspended' } })
  const b = await createWorkspace('Secret B')
  const outsider = await createUser('admin')
  await prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: shared.id, role: 'supervisor' } })
  // Mixed role: being a labeller in B does not grant management of B.
  await prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: admin.id, role: 'labeller' } })
  signInAs(admin)
  const response = await directory.GET(request('/api/user-directory'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.total).toBe(3)
  expect(body.users.map((u: { id: string }) => u.id)).toContain(removed.id)
  expect(JSON.stringify(body)).not.toContain('Secret B')
  expect(JSON.stringify(body)).not.toContain(outsider.email)
  expect((await directory.GET(request(`/api/user-directory?workspace=${b.id}`))).status).toBe(404)
  expect((await directory.GET(request('/api/user-directory?workspace=none'))).status).toBe(404)
  expect((await detail.GET(request('/x'), plainParams({ userId: outsider.id }))).status).toBe(404)
  const removedPage = await (
    await directory.GET(request(`/api/user-directory?workspace=${a.id}&access=removed`))
  ).json()
  expect(removedPage.users.map((u: { id: string }) => u.id)).toEqual([removed.id])
  const csv = await exportRoute.GET(request('/api/user-directory/export'))
  expect(csv.status).toBe(200)
  const text = await csv.text()
  expect(text).toContain(shared.email)
  expect(text).not.toContain('Secret B')
  signInAs(shared)
  expect((await directory.GET(request('/api/user-directory'))).status).toBe(403)
})

it('sorts and pages the operational view before returning rows and filters account/setup/access independently', async () => {
  const ws = await createWorkspace()
  const actor = await createUser('admin', { platformAdmin: true })
  const a = await createUser('labeller')
  const b = await createUser('supervisor')
  await prisma.user.update({ where: { id: a.id }, data: { name: 'AAA', banned: true, mustResetPassword: true } })
  await prisma.user.update({
    where: { id: b.id },
    data: { name: 'ZZZ', invitedAt: new Date(), invitationAcceptedAt: null }
  })
  signInAs(actor)
  const page = await (await directory.GET(request(`/x?workspace=${ws.id}&sort=name&pageSize=1`))).json()
  expect(page.users[0].id).toBe(a.id)
  expect(page.total).toBe(3)
  const disabled = await (await directory.GET(request(`/x?workspace=${ws.id}&state=disabled&setup=password`))).json()
  expect(disabled.users.map((u: { id: string }) => u.id)).toEqual([a.id])
  const invited = await (await directory.GET(request(`/x?workspace=${ws.id}&setup=invited`))).json()
  expect(invited.users.map((u: { id: string }) => u.id)).toEqual([b.id])
})

it('keeps the deletion allowlist aligned with every workspace-owned table', async () => {
  const columns = await prisma.$queryRaw<
    Array<{ table_name: string }>
  >`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'workspaceId'`
  expect([...WORKSPACE_DELETE_TABLES].sort()).toEqual(columns.map(c => c.table_name).sort())
})

it('deletes a complete archived workspace under RLS, retaining other workspaces, accounts, endpoints and a platform audit', async () => {
  const ws = await createWorkspace('Delete me')
  const actor = await createUser('admin', { platformAdmin: true })
  const person = await createUser('labeller')
  const [sentence] = await createSentences(1, [person.id])
  const taxonomy = await createTaxonomy()
  const connection = await createAIConnection()
  await prisma.sentenceAnnotation.create({
    data: {
      workspaceId: ws.id,
      sentenceId: sentence.id,
      taxonomyId: taxonomy.id,
      level: 1,
      nodeCode: '02',
      source: 'user',
      createdById: person.id
    }
  })
  await prisma.comment.create({
    data: { workspaceId: ws.id, sentenceId: sentence.id, authorId: person.id, body: 'Keep accounts' }
  })
  await prisma.taxonomySetting.create({ data: { workspaceId: ws.id, taxonomyId: taxonomy.id } })
  const node = await prisma.taxonomyNode.findFirstOrThrow({ where: { taxonomyId: taxonomy.id } })
  await prisma.taxonomySynonym.create({
    data: { workspaceId: ws.id, taxonomyId: taxonomy.id, nodeId: node.id, synonym: 'Example' }
  })
  await prisma.aILabelingJob.create({
    data: {
      workspaceId: ws.id,
      taxonomyId: taxonomy.id,
      createdById: actor.id,
      totalSentences: 1,
      connectionVersionId: connection.id,
      inputs: { create: { sentenceId: sentence.id, position: 0 } }
    }
  })
  await prisma.labelingActivity.create({
    data: {
      workspaceId: ws.id,
      sentenceId: sentence.id,
      taxonomyId: taxonomy.id,
      actorId: person.id,
      operationId: 'deletion-test'
    }
  })
  const round = await prisma.doubleRound.create({
    data: {
      workspaceId: ws.id,
      sentenceId: sentence.id,
      tasks: {
        create: {
          sentenceId: sentence.id,
          position: 1,
          assigneeId: person.id,
          labels: { create: { taxonomyId: taxonomy.id, level: 1, nodeCode: '02' } }
        }
      },
      outcomes: { create: { sentenceId: sentence.id, taxonomyId: taxonomy.id } }
    }
  })
  expect(round.id).toBeTruthy()
  const invitation = await prisma.workspaceInvitation.create({
    data: { workspaceId: ws.id, email: 'invite@test.local', role: 'labeller', expiresAt: new Date(Date.now() + 1000) }
  })
  await prisma.outgoingMail.create({
    data: { workspaceId: ws.id, userId: person.id, invitationId: invitation.id, purpose: 'workspace_invitation' }
  })
  await prisma.memberImport.create({
    data: {
      workspaceId: ws.id,
      importKey: 'one',
      fileName: 'members.csv',
      rowCount: 1,
      rows: { create: { line: 1, username: person.username, access: 'add' } }
    }
  })
  await prisma.aIEndpointGrant.create({ data: { endpointId: connection.endpointId, workspaceId: ws.id } })
  const other = await createWorkspace('Keep me')
  await createSentences(1)
  signInAs(actor)
  expect(
    (await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))).status
  ).toBe(409)
  await setWorkspaceStatus(ws.id, 'archived')
  const before = await preview.GET(request('/x'), ctx(ws.id))
  expect((await before.json()).counts.Sentence).toBe(1)
  expect(
    (await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: 'wrong' } }), ctx(ws.id))).status
  ).toBe(409)
  const response = await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))
  expect(response.status, await response.clone().text()).toBe(200)
  for (const table of WORKSPACE_DELETE_TABLES) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) FROM "${table}" WHERE "workspaceId" = $1`,
      ws.id
    )
    expect(Number(row!.count), table).toBe(0)
  }
  expect(await prisma.workspace.findUnique({ where: { id: ws.id } })).toBeNull()
  expect(await prisma.sentence.count({ where: { workspaceId: other.id } })).toBe(1)
  expect(await prisma.user.count()).toBe(2)
  expect(await prisma.aIEndpoint.count()).toBe(1)
  expect(
    await prisma.auditLog.findFirst({ where: { action: 'workspace.deleted', workspaceId: null, entityId: ws.id } })
  ).toMatchObject({ payload: expect.objectContaining({ name: ws.name }) })
})

it('refuses workspace-admin deletion and previews, and rechecks an archived workspace that was reopened', async () => {
  const ws = await createWorkspace()
  const admin = await createUser('admin')
  const platform = await createUser('admin', { platformAdmin: true })
  await setWorkspaceStatus(ws.id, 'archived')
  signInAs(admin)
  expect((await preview.GET(request('/x'), ctx(ws.id))).status).toBe(403)
  expect(
    (await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))).status
  ).toBe(403)
  await setWorkspaceStatus(ws.id, 'active')
  signInAs(platform)
  expect(
    (await lifecycle.DELETE(request('/x', { method: 'DELETE', body: { name: ws.name } }), ctx(ws.id))).status
  ).toBe(409)
})

it('refuses account deletion with saved work in a removed workspace and permits an unused account', async () => {
  const ws = await createWorkspace()
  const actor = await createUser('admin', { platformAdmin: true })
  const author = await createUser('labeller')
  const [sentence] = await createSentences(1)
  const taxonomy = await createTaxonomy()
  await prisma.sentenceAnnotation.create({
    data: {
      workspaceId: ws.id,
      sentenceId: sentence.id,
      taxonomyId: taxonomy.id,
      level: 1,
      nodeCode: '02',
      source: 'user',
      createdById: author.id
    }
  })
  await prisma.workspaceMembership.updateMany({ where: { userId: author.id }, data: { status: 'suspended' } })
  const unused = await prisma.user.create({ data: { username: 'unused', email: 'unused@test.local', name: 'Unused' } })
  signInAs(actor)
  expect((await users.DELETE(request('/x', { method: 'DELETE' }), plainParams({ userId: author.id }))).status).toBe(409)
  expect((await users.DELETE(request('/x', { method: 'DELETE' }), plainParams({ userId: unused.id }))).status).toBe(200)
  expect(await prisma.sentenceAnnotation.count()).toBe(1)
  selectWorkspace(ws.id)
})
