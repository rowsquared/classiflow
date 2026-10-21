import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { settleBackgroundTasks } from '@/lib/after-response'
import { createUser, createWorkspace, params, prisma, request, resetDatabase, signInAs, wsId } from './helpers'
import { disableMail, enableMail, publicRequest, startMailWebhook, tokenFrom } from './mail-helpers'

import * as invitationsRoute from '@/app/api/workspaces/[workspaceId]/invitations/route'
import * as invitationRoute from '@/app/api/workspaces/[workspaceId]/invitations/[invitationId]/route'
import * as checkRoute from '@/app/api/invitations/check/route'
import * as acceptRoute from '@/app/api/invitations/accept/route'
import * as workspaceRoute from '@/app/api/workspaces/[workspaceId]/route'

let webhook: Awaited<ReturnType<typeof startMailWebhook>>
let admin: User, supervisor: User, outsider: User
let otherWorkspace: string

beforeAll(async () => {
  await resetDatabase()
  webhook = await startMailWebhook()
  enableMail(webhook.url)
  otherWorkspace = (await createWorkspace('Elsewhere')).id
  outsider = await createUser('labeller')
  await createWorkspace('Invited here')
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
})

async function invite(email: string, role = 'labeller', as: User = admin) {
  signInAs(as)
  const res = await invitationsRoute.POST(request('/x', { method: 'POST', body: { email, role } }), params())
  await settleBackgroundTasks()
  return res
}

const accept = (token: string) => acceptRoute.POST(publicRequest('/api/invitations/accept', { token }))
const check = (token: string) => checkRoute.POST(publicRequest('/api/invitations/check', { token }))

describe('workspace invitations', () => {
  it('answers the same for an existing account and an unknown address', async () => {
    const known = await invite(outsider.email.toUpperCase())
    const unknown = await invite('nobody-yet@test.local')
    expect(known.status).toBe(201)
    expect(unknown.status).toBe(201)
    const shape = (body: { invitation: Record<string, unknown> }) => Object.keys(body.invitation).sort()
    expect(shape(await known.json())).toEqual(shape(await unknown.json()))
    expect(webhook.mails.map(m => m.to).sort()).toEqual(['nobody-yet@test.local', outsider.email].sort())
    expect(webhook.mails[0]!.body).toContain('https://classiflow.test/invitation#t=')
  })

  it('only the invited account can accept, once, and gets the invited role', async () => {
    await invite(outsider.email, 'supervisor')
    const token = tokenFrom(webhook.mails.at(-1))

    signInAs(null)
    const anonymous = await (await check(token)).json()
    expect(anonymous).toMatchObject({ workspaceName: 'Invited here', role: 'supervisor', matchesAccount: null })

    const stranger = await createUser('labeller', { workspaceId: otherWorkspace })
    signInAs(stranger)
    expect((await (await check(token)).json()).matchesAccount).toBe(false)
    expect((await accept(token)).status).toBe(403)

    signInAs(outsider)
    expect((await (await check(token)).json()).matchesAccount).toBe(true)
    const res = await accept(token)
    expect(res.status).toBe(200)
    expect((await res.json()).workspaceId).toBe(wsId())
    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: wsId(), userId: outsider.id } }
    })
    expect(membership).toMatchObject({ role: 'supervisor', status: 'active', addedById: admin.id })
    expect((await accept(token)).status).toBe(404)
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: wsId(), action: 'member.added', entityId: outsider.id }
    })
    expect(entry.payload).toMatchObject({ via: 'invitation' })
  })

  it('a resend replaces the link; a revoked invitation cannot be accepted', async () => {
    const person = await createUser('labeller', { workspaceId: otherWorkspace })
    const created = await (await invite(person.email)).json()
    const first = tokenFrom(webhook.mails.at(-1))
    signInAs(admin)
    expect(
      (await invitationRoute.POST(request('/x', { method: 'POST' }), params({ invitationId: created.invitation.id })))
        .status
    ).toBe(200)
    await settleBackgroundTasks()
    const second = tokenFrom(webhook.mails.at(-1))
    expect(second).not.toBe(first)
    signInAs(person)
    expect((await accept(first)).status).toBe(404)

    signInAs(admin)
    await invitationRoute.DELETE(request('/x', { method: 'DELETE' }), params({ invitationId: created.invitation.id }))
    signInAs(person)
    expect((await accept(second)).status).toBe(404)
  })

  it('is refused when the inviter is no longer an admin', async () => {
    const inviter = await createUser('admin')
    const person = await createUser('labeller', { workspaceId: otherWorkspace })
    await invite(person.email, 'labeller', inviter)
    const token = tokenFrom(webhook.mails.at(-1))
    await prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: wsId(), userId: inviter.id } },
      data: { role: 'labeller' }
    })
    signInAs(person)
    expect((await accept(token)).status).toBe(409)
  })

  it('supervisors cannot invite or resend', async () => {
    const res = await invite('someone@test.local', 'labeller', supervisor)
    expect(res.status).toBe(403)
  })

  it('cannot be accepted in an archived workspace', async () => {
    const person = await createUser('labeller', { workspaceId: otherWorkspace })
    await invite(person.email)
    const token = tokenFrom(webhook.mails.at(-1))
    signInAs(admin)
    await workspaceRoute.PUT(request('/x', { method: 'PUT', body: { status: 'archived' } }), params())
    try {
      signInAs(person)
      expect((await accept(token)).status).toBe(409)
    } finally {
      signInAs(admin)
      await workspaceRoute.PUT(request('/x', { method: 'PUT', body: { status: 'active' } }), params())
    }
  })

  it('needs mail', async () => {
    disableMail()
    try {
      expect((await invite('later@test.local')).status).toBe(409)
    } finally {
      enableMail(webhook.url)
    }
  })
})
