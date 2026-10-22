import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import type { User } from '@/lib/generated/prisma/client'
import { settleBackgroundTasks } from '@/lib/after-response'
import { checkPassword } from '@/lib/passwords'
import {
  createUser,
  createWorkspace,
  params,
  prisma,
  request,
  resetDatabase,
  selectWorkspace,
  signInAs,
  wsId
} from './helpers'
import { disableMail, enableMail, startMailWebhook } from './mail-helpers'

import * as importRoute from '@/app/api/workspaces/[workspaceId]/users/import/route'
import * as importStatusRoute from '@/app/api/workspaces/[workspaceId]/users/import/[importId]/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/users/export/route'

const HEADER = 'username,email,name,role,supervisor,access,password'

let webhook: Awaited<ReturnType<typeof startMailWebhook>>
let admin: User, supervisor: User

beforeAll(async () => {
  await resetDatabase()
  webhook = await startMailWebhook()
  enableMail(webhook.url)
  await createWorkspace()
  admin = await createUser('admin')
  supervisor = await createUser('supervisor')
})

afterAll(async () => {
  disableMail()
  await webhook.close()
})

beforeEach(async () => {
  await settleBackgroundTasks()
  webhook.mails.length = 0
  signInAs(admin)
})

function upload(csv: string, { dryRun, importKey }: { dryRun: boolean; importKey?: string }) {
  const form = new FormData()
  form.set('file', new File([csv], 'members.csv', { type: 'text/csv' }))
  if (importKey) form.set('importKey', importKey)
  return importRoute.POST(
    new NextRequest(new URL(`/x?dryRun=${dryRun}`, 'http://localhost:3000'), { method: 'POST', body: form }),
    params()
  )
}

let n = 0
const key = () => `import-key-${++n}-${Date.now()}`

describe('member CSV import', () => {
  it('is for workspace admins only', async () => {
    signInAs(supervisor)
    expect((await upload(`${HEADER}\nabc,abc@x.org,A,labeller,,generate,`, { dryRun: true })).status).toBe(403)
  })

  it('dry run reports every row error and writes and mails nothing', async () => {
    const csv = [
      HEADER,
      `boss1,boss1@x.org,Boss,supervisor,,invite,`,
      `lab1,lab1@x.org,Lab,labeller,boss1,generate,`,
      `${admin.username},new@x.org,Dup,labeller,,generate,`,
      `lab2,lab2@x.org,Lab,labeller,ghost,password,short`
    ].join('\n')
    const users = await prisma.user.count()
    const res = await upload(csv, { dryRun: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.errors.map((e: { line: number; field: string }) => [e.line, e.field])).toEqual([
      [4, 'username'],
      [5, 'password'],
      [5, 'supervisor']
    ])
    expect(JSON.stringify(body)).not.toContain('short')
    await settleBackgroundTasks()
    expect(await prisma.user.count()).toBe(users)
    expect(webhook.mails).toHaveLength(0)
    expect(await prisma.memberImport.count()).toBe(0)
  })

  it('commits all accounts in one go, mails after the commit, and a replay creates and mails nothing', async () => {
    const csv = [
      HEADER,
      `lab3,lab3@x.org,Lab Three,labeller,boss3,generate,`,
      `boss3,boss3@x.org,Boss Three,supervisor,${supervisor.username},invite,`,
      `lab4,lab4@x.org,Lab Four,labeller,boss3,email_password,`,
      `lab5,lab5@x.org,Lab Five,labeller,,password,given-pass-phrase`
    ].join('\n')
    const importKey = key()
    const res = await upload(csv, { dryRun: false, importKey })
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    const byName = Object.fromEntries(body.rows.map((r: { username: string }) => [r.username, r]))
    expect(Object.keys(byName).sort()).toEqual(['boss3', 'lab3', 'lab4', 'lab5'])
    expect(byName.lab3.password).toMatch(/^[A-Za-z0-9]{18}$/)
    expect(byName.lab4.password).toBeUndefined()
    expect(byName.lab5.password).toBeUndefined()
    expect(await checkPassword(prisma, byName.lab3.userId, byName.lab3.password)).toBe(true)
    expect(await checkPassword(prisma, byName.lab5.userId, 'given-pass-phrase')).toBe(true)

    const boss = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: byName.boss3.userId } })
    const lab = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: byName.lab3.userId } })
    const sup = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: supervisor.id } })
    expect(lab.supervisorMembershipId).toBe(boss.id)
    expect(boss.supervisorMembershipId).toBe(sup.id)

    await settleBackgroundTasks()
    expect(webhook.mails.map(m => m.to).sort()).toEqual(['boss3@x.org', 'lab4@x.org'])

    // Nothing with a password is stored: not in the import rows, mail rows or audit.
    const stored = JSON.stringify(
      await prisma.$queryRawUnsafe(
        `SELECT row_to_json(r)::text FROM "MemberImportRow" r UNION ALL SELECT row_to_json(m)::text FROM "OutgoingMail" m UNION ALL SELECT row_to_json(a)::text FROM "AuditLog" a`
      )
    )
    expect(stored).not.toContain(byName.lab3.password)
    expect(stored).not.toContain('given-pass-phrase')

    const replay = await upload(csv, { dryRun: false, importKey })
    expect(replay.status).toBe(200)
    const replayBody = await replay.json()
    expect(replayBody.replayed).toBe(true)
    expect(JSON.stringify(replayBody)).not.toContain(byName.lab3.password)
    await settleBackgroundTasks()
    expect(webhook.mails).toHaveLength(2)
    expect(await prisma.user.count({ where: { username: { in: ['lab3', 'boss3', 'lab4', 'lab5'] } } })).toBe(4)

    const status = await importStatusRoute.GET(
      new NextRequest(new URL('/x', 'http://localhost:3000')),
      params({ importId: body.importId })
    )
    const statusBody = await status.json()
    expect(statusBody.rows.find((r: { username: string }) => r.username === 'boss3').mailStatus).toBe('sent')
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'members.imported', workspaceId: wsId() } })
    expect(audit.payload).toMatchObject({
      count: 4,
      access: { generate: 1, invite: 1, email_password: 1, password: 1 }
    })
  })

  it('concurrent commits with the same key create the accounts once', async () => {
    const csv = [HEADER, `lab6,lab6@x.org,Six,labeller,,generate,`].join('\n')
    const importKey = key()
    const results = await Promise.all([
      upload(csv, { dryRun: false, importKey }),
      upload(csv, { dryRun: false, importKey })
    ])
    expect(results.map(r => r.status).sort()).toEqual([200, 201])
    expect(await prisma.user.count({ where: { username: 'lab6' } })).toBe(1)
  })

  it('creates nothing when a row became invalid after the preview', async () => {
    const csv = [HEADER, `lab7,lab7@x.org,Seven,labeller,,generate,`, `lab8,lab8@x.org,Eight,labeller,,generate,`].join(
      '\n'
    )
    expect((await (await upload(csv, { dryRun: true })).json()).ok).toBe(true)
    await createUser('labeller').then(u => prisma.user.update({ where: { id: u.id }, data: { username: 'lab8' } }))
    const res = await upload(csv, { dryRun: false, importKey: key() })
    expect(res.status).toBe(400)
    expect(await prisma.user.count({ where: { username: 'lab7' } })).toBe(0)
  })

  it('refuses mail access modes when mail is off', async () => {
    disableMail()
    try {
      const body = await (await upload(`${HEADER}\nlab9,lab9@x.org,Nine,labeller,,invite,`, { dryRun: true })).json()
      expect(body.errors[0]).toMatchObject({ line: 2, field: 'access' })
    } finally {
      enableMail(webhook.url)
    }
  })
})

describe('member CSV export', () => {
  const download = () => exportRoute.GET(request('/x'), params())

  it('lists every member of this workspace, suspended ones included, for admins only', async () => {
    const labeller = await createUser('labeller', { supervisorId: supervisor.id })
    const suspended = await createUser('labeller')
    await prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: wsId(), userId: suspended.id } },
      data: { status: 'suspended' }
    })
    const home = wsId()
    const elsewhere = await createWorkspace()
    const stranger = await createUser('labeller', { workspaceId: elsewhere.id })
    selectWorkspace(home)

    signInAs(admin)
    const res = await download()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const csv = await res.text()
    const lines = csv.split('\n')
    expect(lines[0]).toMatch(/^"username","email","name","role","supervisor","status"/)
    expect(lines.find(l => l.startsWith(`"${labeller.username}"`))).toContain(
      `"${labeller.email}","${labeller.name}","labeller","${supervisor.username}","active"`
    )
    expect(lines.find(l => l.startsWith(`"${suspended.username}"`))).toContain('"suspended"')
    expect(csv).not.toContain(stranger.username)
    expect(await prisma.auditLog.count({ where: { workspaceId: home, action: 'members.exported' } })).toBe(1)

    signInAs(supervisor)
    expect((await download()).status).toBe(403)
  })
})
