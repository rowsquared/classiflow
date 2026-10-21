import { beforeAll, describe, expect, it } from 'vitest'
import type { User } from '@/lib/generated/prisma/client'
import { createUser, createWorkspace, params, prisma, request, resetDatabase, signInAs, wsId } from './helpers'

import * as queueRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as activeJobsRoute from '@/app/api/workspaces/[workspaceId]/ai-jobs/active/route'

let labeller: User, admin: User

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  labeller = await createUser('labeller')
  admin = await createUser('admin')
})

const membership = (user: User) => prisma.workspaceMembership.findUniqueOrThrow({
  where: { workspaceId_userId: { workspaceId: wsId(), userId: user.id } },
})
const setLastSeen = (user: User, minutesAgo: number) => prisma.workspaceMembership.update({
  where: { workspaceId_userId: { workspaceId: wsId(), userId: user.id } },
  data: { lastSeenAt: new Date(Date.now() - minutesAgo * 60_000) },
})

describe('last seen', () => {
  it('is written by a workspace request without touching updatedAt', async () => {
    const before = await membership(labeller)
    expect(before.lastSeenAt).toBeNull()
    signInAs(labeller)
    expect((await queueRoute.GET(request('/x'), params())).status).toBe(200)
    const after = await membership(labeller)
    expect(after.lastSeenAt).not.toBeNull()
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it('is not rewritten within five minutes, and is after', async () => {
    await setLastSeen(labeller, 2)
    const recent = (await membership(labeller)).lastSeenAt
    signInAs(labeller)
    await queueRoute.GET(request('/x'), params())
    expect((await membership(labeller)).lastSeenAt).toEqual(recent)

    await setLastSeen(labeller, 10)
    const stale = (await membership(labeller)).lastSeenAt!
    await queueRoute.GET(request('/x'), params())
    expect((await membership(labeller)).lastSeenAt!.getTime()).toBeGreaterThan(stale.getTime())
  })

  it('is not written by the background job poll', async () => {
    await setLastSeen(admin, 60)
    const old = (await membership(admin)).lastSeenAt
    signInAs(admin)
    expect((await activeJobsRoute.GET(request('/x'), params())).status).toBe(200)
    expect((await membership(admin)).lastSeenAt).toEqual(old)
  })
})
