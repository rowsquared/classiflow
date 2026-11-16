import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { setPassword } from '@/lib/passwords'
import { allowRequest } from '@/lib/rate-limit'
import { createUser, createWorkspace, params, plainParams, prisma, request, resetDatabase, signInAs } from './helpers'

import * as membersRoute from '@/app/api/workspaces/[workspaceId]/users/route'
import * as accountRoute from '@/app/api/users/[userId]/route'
import * as resetPasswordRoute from '@/app/api/auth/reset-password/route'
import * as authRoute from '@/app/api/auth/[...all]/route'

vi.hoisted(() => {
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.BETTER_AUTH_SECRET = 'integration-password-test-only-0123456789'
  process.env.SIGN_IN_ACCOUNT_RATE_LIMIT = '10'
  process.env.SIGN_IN_RATE_LIMIT = '10'
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let admin: User, platformAdmin: User

it('limits concurrent requests atomically and resets a stale window', async () => {
  const limit = { windowSeconds: 60, max: 2 }
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => allowRequest('concurrent-window', limit)))
  expect(outcomes.filter(Boolean)).toHaveLength(2)
  await prisma.appRateLimit.update({ where: { key: 'classiflow:concurrent-window' }, data: { lastRequest: 0n } })
  expect(await allowRequest('concurrent-window', limit)).toBe(true)
  expect(await allowRequest('concurrent-window', limit)).toBe(true)
  expect(await allowRequest('concurrent-window', limit)).toBe(false)
})

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  admin = await createUser('admin')
  platformAdmin = await createUser('admin', { platformAdmin: true })
})

const create = (tempPassword: string) =>
  membersRoute.POST(
    request('/x', {
      method: 'POST',
      body: { username: 'maria', email: 'maria@test.local', name: 'Maria Rossi', role: 'labeller', tempPassword }
    }),
    params()
  )

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
      request('/x', { method: 'PUT', body: { newPassword: '1234567890' } }),
      plainParams({ userId: target.id })
    )
    expect(res.status).toBe(400)
  })

  it('makes a forced change pick a new, acceptable password', async () => {
    const user = await createUser('labeller', { mustResetPassword: true })
    await prisma.$transaction(tx => setPassword(tx, user.id, 'handed-out-temp-7'))
    signInAs(user)
    const change = (newPassword: string) =>
      resetPasswordRoute.POST(
        request('/api/auth/reset-password', {
          method: 'POST',
          body: { currentPassword: 'handed-out-temp-7', newPassword }
        })
      )
    expect((await change('handed-out-temp-7')).status).toBe(400)
    expect((await change('too-short')).status).toBe(400)
    expect((await change('quiet-river-stone')).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mustResetPassword).toBe(false)
  })

  it('shares sign-in limits across email, username and client addresses', async () => {
    const user = await createUser('labeller')
    await prisma.appRateLimit.create({
      data: {
        key: `classiflow:sign-in:account:${user.id}`,
        count: 9,
        lastRequest: BigInt(Date.now())
      }
    })
    const signIn = (field: 'username' | 'email', address: string) =>
      authRoute.POST(
        new Request(`http://localhost:3000/api/auth/sign-in/${field}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
          body: JSON.stringify({ [field]: user[field].toUpperCase(), password: 'known-wrong-password' })
        })
      )
    expect((await signIn('username', '192.0.2.10')).status).toBe(401)
    expect((await signIn('email', '192.0.2.11')).status).toBe(429)
  })

  it('uses the proxy-added address and ignores a forged prefix', async () => {
    const user = await createUser('labeller')
    await prisma.appRateLimit.create({
      data: { key: 'classiflow:sign-in:ip:192.0.2.20', count: 10, lastRequest: BigInt(Date.now()) }
    })
    const limited = await authRoute.POST(
      new Request('http://localhost:3000/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.21, 192.0.2.20' },
        body: JSON.stringify({ username: user.username, password: 'known-wrong-password' })
      })
    )
    expect(limited.status).toBe(429)
  })

  it('limits password changes per signed-in user', async () => {
    const user = await createUser('labeller')
    signInAs(user)
    await prisma.appRateLimit.create({
      data: {
        key: `classiflow:reset-password:${user.id}`,
        count: 10,
        lastRequest: BigInt(Date.now())
      }
    })
    const result = await resetPasswordRoute.POST(
      request('/api/auth/reset-password', {
        method: 'POST',
        body: { currentPassword: 'wrong', newPassword: 'quiet-river-stone' }
      })
    )
    expect(result.status).toBe(429)
  })
})
