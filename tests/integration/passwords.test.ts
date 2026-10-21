import { beforeAll, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { setPassword } from '@/lib/passwords'
import { createUser, createWorkspace, params, plainParams, prisma, request, resetDatabase, signInAs } from './helpers'

import * as membersRoute from '@/app/api/workspaces/[workspaceId]/users/route'
import * as accountRoute from '@/app/api/users/[userId]/route'
import * as resetPasswordRoute from '@/app/api/auth/reset-password/route'

let admin: User, platformAdmin: User

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  admin = await createUser('admin')
  platformAdmin = await createUser('admin', { platformAdmin: true })
})

const create = (tempPassword: string) => membersRoute.POST(request('/x', {
  method: 'POST',
  body: { username: 'maria', email: 'maria@test.local', name: 'Maria Rossi', role: 'labeller', tempPassword },
}), params())

describe('password policy', () => {
  it('refuses weak or personal temporary passwords when creating members', async () => {
    signInAs(admin)
    for (const weak of ['short-1', 'password123', 'maria-welcome-2026', 'rossi-family-99']) {
      const res = await create(weak)
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe('tempPassword')
    }
    expect(await prisma.user.count({ where: { username: 'maria' } })).toBe(0)
    expect((await create('blue-kettle-orbit')).status).toBe(201)
  })

  it('applies to admin-set passwords on accounts', async () => {
    signInAs(platformAdmin)
    const target = await createUser('labeller')
    const res = await accountRoute.PUT(
      request('/x', { method: 'PUT', body: { newPassword: '1234567890' } }), plainParams({ userId: target.id }))
    expect(res.status).toBe(400)
  })

  it('makes a forced change pick a new, acceptable password', async () => {
    const user = await createUser('labeller', { mustResetPassword: true })
    await prisma.$transaction(tx => setPassword(tx, user.id, 'handed-out-temp-7'))
    signInAs(user)
    const change = (newPassword: string) => resetPasswordRoute.POST(request('/api/auth/reset-password', {
      method: 'POST', body: { currentPassword: 'handed-out-temp-7', newPassword },
    }))
    expect((await change('handed-out-temp-7')).status).toBe(400)
    expect((await change('too-short')).status).toBe(400)
    expect((await change('quiet-river-stone')).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mustResetPassword).toBe(false)
  })
})
