import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { settleBackgroundTasks } from '@/lib/after-response'
import { deliverMail, queueMail, recoverOutbox } from '@/lib/mail/outbox'
import { checkPassword, setPassword } from '@/lib/passwords'
import {
  createUser,
  createWorkspace,
  params,
  plainParams,
  prisma,
  request,
  resetDatabase,
  signInAs,
  wsId
} from './helpers'
import { disableMail, enableMail, publicRequest, startMailWebhook, tokenFrom } from './mail-helpers'

import * as forgotRoute from '@/app/api/auth/forgot-password/route'
import * as checkRoute from '@/app/api/auth/set-password/check/route'
import * as confirmRoute from '@/app/api/auth/set-password/confirm/route'
import * as membersRoute from '@/app/api/workspaces/[workspaceId]/users/route'
import * as memberRoute from '@/app/api/workspaces/[workspaceId]/users/[userId]/route'
import * as memberMailRoute from '@/app/api/workspaces/[workspaceId]/users/[userId]/mail/route'
import * as accountRoute from '@/app/api/users/[userId]/route'
import * as systemMailRoute from '@/app/api/system/mail/route'
import * as workspacesRoute from '@/app/api/workspaces/route'

let webhook: Awaited<ReturnType<typeof startMailWebhook>>
let admin: User, supervisor: User, platformAdmin: User

beforeAll(async () => {
  await resetDatabase()
  webhook = await startMailWebhook()
  enableMail(webhook.url)
  await createWorkspace()
  admin = await createUser('admin')
  supervisor = await createUser('supervisor')
  platformAdmin = await createUser('admin', { platformAdmin: true })
})

afterAll(async () => {
  disableMail()
  await webhook.close()
})

beforeEach(async () => {
  await settleBackgroundTasks()
  webhook.mails.length = 0
  webhook.state.status = 200
  webhook.state.delayMs = 0
})

const forgot = (email: string) => forgotRoute.POST(publicRequest('/api/auth/forgot-password', { email }))
const check = (token: string) => checkRoute.POST(publicRequest('/api/auth/set-password/check', { token }))
const confirm = (token: string, newPassword: string) =>
  confirmRoute.POST(publicRequest('/api/auth/set-password/confirm', { token, newPassword }))

async function newMember(access: string, extra: Record<string, unknown> = {}) {
  signInAs(admin)
  const n = Math.random().toString(36).slice(2, 8)
  const res = await membersRoute.POST(
    request('/x', {
      method: 'POST',
      body: { username: `m${n}`, email: `m${n}@test.local`, name: `Member ${n}`, role: 'labeller', access, ...extra }
    }),
    params()
  )
  expect(res.status).toBe(201)
  await settleBackgroundTasks()
  const body = await res.json()
  return { id: body.user.id as string, email: `m${n}@test.local`, username: `m${n}`, body }
}

describe('outbox', () => {
  it('sends a claimed mail once even when two deliveries race', async () => {
    const user = await createUser('labeller')
    const id = await queueMail(prisma, { purpose: 'password_changed', userId: user.id })
    await Promise.all([deliverMail([id]), deliverMail([id])])
    expect(webhook.mails).toHaveLength(1)
    expect(webhook.mails[0]!.secret).toBe('test-webhook-secret')
    expect(webhook.mails[0]!.to).toBe(user.email)
    const row = await prisma.outgoingMail.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('maps refusals to failed and server errors to unknown', async () => {
    const user = await createUser('labeller')
    webhook.state.status = 401
    const refused = await queueMail(prisma, { purpose: 'password_changed', userId: user.id })
    await deliverMail([refused])
    webhook.state.status = 502
    const broken = await queueMail(prisma, { purpose: 'password_changed', userId: user.id })
    await deliverMail([broken])
    expect((await prisma.outgoingMail.findUniqueOrThrow({ where: { id: refused } })).status).toBe('failed')
    expect((await prisma.outgoingMail.findUniqueOrThrow({ where: { id: broken } })).status).toBe('unknown')
  })

  it('turns a mail abandoned while sending into unknown and never resends it', async () => {
    const user = await createUser('labeller')
    const stale = await prisma.outgoingMail.create({
      data: {
        purpose: 'password_link',
        userId: user.id,
        status: 'sending',
        claimedAt: new Date(Date.now() - 10 * 60_000)
      }
    })
    const pending = await prisma.outgoingMail.create({
      data: { purpose: 'password_changed', userId: user.id, createdAt: new Date(Date.now() - 5 * 60_000) }
    })
    const lostCredentials = await prisma.outgoingMail.create({
      data: { purpose: 'credentials', userId: user.id, createdAt: new Date(Date.now() - 10 * 60_000) }
    })
    await recoverOutbox({ force: true })
    await settleBackgroundTasks()
    expect((await prisma.outgoingMail.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('unknown')
    expect((await prisma.outgoingMail.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('sent')
    expect((await prisma.outgoingMail.findUniqueOrThrow({ where: { id: lostCredentials.id } })).status).toBe('failed')
    expect(webhook.mails.map(m => m.subject)).toEqual(['Your classiflow password was changed'])
  })

  it('tells platform admins whether mail is on, without secrets', async () => {
    signInAs(platformAdmin)
    const body = await (await systemMailRoute.GET()).json()
    expect(body).toEqual({ enabled: true, transport: 'n8n', baseUrl: 'https://classiflow.test' })
    signInAs(admin)
    expect((await systemMailRoute.GET()).status).toBe(403)
  })
})

describe('forgotten password', () => {
  it('answers identically for known, unknown and banned addresses and mails only the active account', async () => {
    const known = await createUser('labeller')
    const banned = await createUser('labeller')
    await prisma.user.update({ where: { id: banned.id }, data: { banned: true } })
    const answers = []
    for (const email of [known.email, 'nobody@test.local', banned.email]) {
      const res = await forgot(email.toUpperCase())
      answers.push({ status: res.status, body: await res.json() })
    }
    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(answers[0])
    await settleBackgroundTasks()
    expect(webhook.mails.map(m => m.to)).toEqual([known.email])
    expect(webhook.mails[0]!.body).toContain(`https://classiflow.test/set-password#t=`)
  })

  it('sends one link per account per cooldown period', async () => {
    const user = await createUser('labeller')
    await forgot(user.email)
    await forgot(user.email)
    await settleBackgroundTasks()
    expect(webhook.mails).toHaveLength(1)
  })

  it('is not available without mail', async () => {
    disableMail()
    try {
      expect((await forgot('a@test.local')).status).toBe(404)
    } finally {
      enableMail(webhook.url)
    }
  })

  it('limits requests per client address', async () => {
    const statuses = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await forgotRoute.POST(publicRequest('/x', { email: `x${i}@test.local` }, '192.0.2.77'))).status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe('password links', () => {
  async function linkFor(user: User) {
    await forgot(user.email)
    await settleBackgroundTasks()
    return tokenFrom(webhook.mails.at(-1))
  }

  it('opening a link spends nothing; confirming sets the password once and ends every session', async () => {
    const user = await createUser('labeller', { mustResetPassword: true })
    await prisma.$transaction(tx => setPassword(tx, user.id, 'old-temporary-pass-1'))
    const token = await linkFor(user)

    expect((await check(token)).status).toBe(200)
    expect((await check(token)).status).toBe(200)
    expect((await (await check(token)).json()).username).toBe(user.username)

    const weak = await confirm(token, 'password123')
    expect(weak.status).toBe(400)
    const same = await confirm(token, 'old-temporary-pass-1')
    expect((await same.json()).error).toMatch(/different/)

    const ok = await confirm(token, 'violet-harbor-lantern')
    expect(ok.status).toBe(200)
    expect(await checkPassword(prisma, user.id, 'violet-harbor-lantern')).toBe(true)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.mustResetPassword).toBe(false)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)

    expect((await confirm(token, 'another-good-phrase')).status).toBe(400)
    expect((await check(token)).status).toBe(404)
    await settleBackgroundTasks()
    expect(webhook.mails.at(-1)!.subject).toBe('Your classiflow password was changed')
  })

  it('lets only one of two concurrent confirmations succeed', async () => {
    const user = await createUser('labeller')
    const token = await linkFor(user)
    const results = await Promise.all([
      confirm(token, 'first-candidate-phrase'),
      confirm(token, 'second-candidate-phrase')
    ])
    expect(results.map(r => r.status).sort()).toEqual([200, 400])
  })

  it('dies when the password, the email or the ban state changes', async () => {
    const a = await createUser('labeller')
    const tokenA = await linkFor(a)
    await prisma.$transaction(tx => setPassword(tx, a.id, 'admin-set-password-9'))
    expect((await check(tokenA)).status).toBe(404)

    const b = await createUser('labeller')
    const tokenB = await linkFor(b)
    await prisma.user.update({ where: { id: b.id }, data: { email: `changed-${b.email}` } })
    expect((await check(tokenB)).status).toBe(404)

    const c = await createUser('labeller')
    const tokenC = await linkFor(c)
    await prisma.user.update({ where: { id: c.id }, data: { banned: true } })
    expect((await check(tokenC)).status).toBe(404)
    expect((await confirm(tokenC, 'banned-user-phrase')).status).toBe(400)
  })

  it('rejects malformed and guessed tokens', async () => {
    const user = await createUser('labeller')
    expect((await check('nonsense')).status).toBe(404)
    expect((await check(`${user.id}.${'A'.repeat(43)}`)).status).toBe(404)
  })

  it('admins send a link to local accounts only; supervisors cannot', async () => {
    const local = await newMember('password', { tempPassword: 'temporary-start-77' })
    signInAs(supervisor)
    const asSupervisor = await memberMailRoute.POST(
      request('/x', { method: 'POST', body: { purpose: 'password_link' } }),
      params({ userId: local.id })
    )
    expect(asSupervisor.status).toBe(403)

    signInAs(admin)
    const res = await memberMailRoute.POST(
      request('/x', { method: 'POST', body: { purpose: 'password_link' } }),
      params({ userId: local.id })
    )
    expect(res.status).toBe(200)
    await settleBackgroundTasks()
    expect(webhook.mails.at(-1)!.to).toBe(local.email)
    const audit = await prisma.auditLog.findMany({ where: { entityId: local.id, action: { startsWith: 'mail.' } } })
    expect(audit.map(a => a.action).sort()).toEqual(['mail.password_link_requested', 'mail.sent'])

    const shared = await createUser('labeller')
    await prisma.user.update({ where: { id: shared.id }, data: { lastLogin: new Date() } })
    const refused = await memberMailRoute.POST(
      request('/x', { method: 'POST', body: { purpose: 'password_link' } }),
      params({ userId: shared.id })
    )
    expect(refused.status).toBe(403)
  })
})

describe('creating members with mail', () => {
  it('invites a new account to choose its password', async () => {
    const member = await newMember('invite')
    expect(member.body.mail).toMatchObject({ status: 'pending' })
    const mail = webhook.mails.find(m => m.to === member.email)!
    expect(mail.subject).toBe('Your classiflow account')
    expect(await prisma.account.count({ where: { userId: member.id } })).toBe(0)
    const res = await confirm(tokenFrom(mail), 'chosen-by-the-person')
    expect(res.status).toBe(200)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user.invitationAcceptedAt).not.toBeNull()
    expect(user.mustResetPassword).toBe(false)
    expect(user.createdById).toBe(admin.id)
    // A first password is not a change: no notice.
    await settleBackgroundTasks()
    expect(webhook.mails.filter(m => m.to === member.email)).toHaveLength(1)
  })

  it('mails a generated temporary password that is stored nowhere but as a hash', async () => {
    const member = await newMember('email_password')
    const mail = webhook.mails.find(m => m.to === member.email)!
    const password = /Temporary password: ([A-Za-z0-9]{18})/.exec(mail.body)?.[1]
    expect(password).toBeDefined()
    expect(mail.body.slice(0, mail.body.indexOf('<h1'))).not.toContain(password)
    expect(member.body.user.mustResetPassword).toBe(true)
    expect(JSON.stringify(member.body)).not.toContain(password)
    expect(await checkPassword(prisma, member.id, password!)).toBe(true)
    const dump = await prisma.$queryRawUnsafe<Array<{ found: number }>>(
      `SELECT count(*)::int AS found FROM (
         SELECT row_to_json(m)::text AS t FROM "OutgoingMail" m
         UNION ALL SELECT row_to_json(a)::text FROM "AuditLog" a
         UNION ALL SELECT row_to_json(v)::text FROM "Verification" v
         UNION ALL SELECT row_to_json(u)::text FROM "User" u
       ) rows WHERE t LIKE $1`,
      `%${password}%`
    )
    expect(dump[0]!.found).toBe(0)
    const row = await prisma.outgoingMail.findFirstOrThrow({ where: { userId: member.id } })
    expect(row).toMatchObject({ purpose: 'credentials', status: 'sent', attempts: 1 })
  })

  it('keeps the account when the credential mail fails, and never retries it', async () => {
    webhook.state.status = 503
    const member = await newMember('email_password')
    expect(await prisma.user.count({ where: { id: member.id } })).toBe(1)
    const row = await prisma.outgoingMail.findFirstOrThrow({ where: { userId: member.id } })
    expect(row.status).toBe('unknown')
    webhook.state.status = 200
    await recoverOutbox({ force: true })
    await settleBackgroundTasks()
    expect(webhook.mails.filter(m => m.to === member.email)).toHaveLength(1)
  })

  it('refuses mail modes when mail is off', async () => {
    disableMail()
    try {
      signInAs(admin)
      const res = await membersRoute.POST(
        request('/x', {
          method: 'POST',
          body: { username: 'offmail', email: 'offmail@test.local', name: 'Off', role: 'labeller', access: 'invite' }
        }),
        params()
      )
      expect(res.status).toBe(400)
    } finally {
      enableMail(webhook.url)
    }
  })
})

describe('changing a member email', () => {
  it('local accounts: new address, old links dead, a notice to the old address, no address in the audit', async () => {
    const member = await newMember('password', { tempPassword: 'temporary-start-88' })
    await forgot(member.email)
    await settleBackgroundTasks()
    const token = tokenFrom(webhook.mails.at(-1))

    signInAs(admin)
    const res = await memberRoute.PUT(
      request('/x', { method: 'PUT', body: { email: `NEW-${member.email}` } }),
      params({ userId: member.id })
    )
    expect(res.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).email).toBe(`new-${member.email}`)
    expect((await check(token)).status).toBe(404)
    await settleBackgroundTasks()
    expect(webhook.mails.at(-1)).toMatchObject({
      to: member.email,
      subject: 'Your classiflow email address was changed'
    })
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.email_changed', entityId: member.id }
    })
    expect(JSON.stringify(entry.payload)).not.toContain('@')
  })

  it('refuses taken addresses and accounts used beyond this workspace', async () => {
    const member = await newMember('password', { tempPassword: 'temporary-start-99' })
    signInAs(admin)
    const taken = await memberRoute.PUT(
      request('/x', { method: 'PUT', body: { email: admin.email, role: 'supervisor' } }),
      params({ userId: member.id })
    )
    expect(taken.status).toBe(400)
    const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: member.id } })
    expect(membership.role).toBe('labeller')

    const shared = await createUser('labeller')
    await prisma.user.update({ where: { id: shared.id }, data: { lastLogin: new Date() } })
    const refused = await memberRoute.PUT(
      request('/x', { method: 'PUT', body: { email: 'other@test.local' } }),
      params({ userId: shared.id })
    )
    expect(refused.status).toBe(403)

    signInAs(platformAdmin)
    const platform = await accountRoute.PUT(
      request('/x', { method: 'PUT', body: { email: 'shared-new@test.local' } }),
      plainParams({ userId: shared.id })
    )
    expect(platform.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: shared.id } })).email).toBe('shared-new@test.local')
  })
})

describe('membership audit', () => {
  it('records the workspace and its first admin in the creating transaction', async () => {
    signInAs(platformAdmin)
    const res = await workspacesRoute.POST(
      request('/x', { method: 'POST', body: { name: 'Audited', adminUserId: admin.id } })
    )
    expect(res.status).toBe(201)
    const { workspace } = await res.json()
    const entries = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: workspace.id }, { workspaceId: workspace.id }] },
      orderBy: { createdAt: 'asc' }
    })
    expect(entries.map(e => [e.action, e.workspaceId])).toEqual([
      ['workspace.created', null],
      ['member.added', workspace.id]
    ])
    expect(wsId()).not.toBe(workspace.id)
  })
})
