import { beforeAll, describe, expect, it } from 'vitest'
import type { Sentence, User } from '@/lib/generated/prisma/client'
import { db } from '@/lib/workspace/db'
import {
  prisma,
  plainParams,
  wsId,
  inWorkspace,
  createWorkspace,
  createSentences,
  createTaxonomy,
  createUser,
  params,
  request,
  resetDatabase,
  signInAs
} from './helpers'

import * as queueRoute from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as statsRoute from '@/app/api/workspaces/[workspaceId]/sentences/stats/route'
import * as detailRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/route'
import * as annotationsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/annotations/route'
import * as bulkRoute from '@/app/api/workspaces/[workspaceId]/sentences/bulk-label/route'
import * as commentsRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/comments/route'
import * as flagRoute from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/flag/route'
import * as assignRoute from '@/app/api/workspaces/[workspaceId]/sentences/assign/route'
import * as usersRoute from '@/app/api/workspaces/[workspaceId]/users/route'
import * as userRoute from '@/app/api/workspaces/[workspaceId]/users/[userId]/route'
import * as accountRoute from '@/app/api/users/[userId]/route'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'
import * as resetPasswordRoute from '@/app/api/auth/reset-password/route'
import * as progressOverviewRoute from '@/app/api/workspaces/[workspaceId]/progress/overview/route'
import * as taxonomiesRoute from '@/app/api/workspaces/[workspaceId]/taxonomies/route'

// Team tree:  admin
//             s1 (supervisor) -> s2 (supervisor) -> s3 (supervisor) -> deep (labeller)
//                             -> direct (labeller)
//             t1 (supervisor) -> other (labeller)
let admin: User, s1: User, s2: User, s3: User, deep: User, direct: User, t1: User, other: User
let ownRecord: Sentence, otherRecord: Sentence, unassigned: Sentence
let taxKey: string

beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  await createWorkspace()
  await createWorkspace()
  admin = await createUser('admin', { platformAdmin: true })
  s1 = await createUser('supervisor')
  s2 = await createUser('supervisor', { supervisorId: s1.id })
  s3 = await createUser('supervisor', { supervisorId: s2.id })
  deep = await createUser('labeller', { supervisorId: s3.id })
  direct = await createUser('labeller', { supervisorId: s1.id })
  t1 = await createUser('supervisor')
  other = await createUser('labeller', { supervisorId: t1.id })
  ;[ownRecord] = await createSentences(1, [deep.id])
  ;[otherRecord] = await createSentences(1, [other.id])
  ;[unassigned] = await createSentences(1)
  taxKey = (await createTaxonomy()).key
})

const ids = (body: { sentences: Array<{ id: string }> }) => body.sentences.map(s => s.id).sort()

describe('anonymous callers', () => {
  it('get 401 and cause no writes', async () => {
    signInAs(null)
    expect((await queueRoute.GET(request('/api/sentences'), params())).status).toBe(401)
    expect((await taxonomiesRoute.GET(request('/'), params())).status).toBe(401)
    const res = await commentsRoute.POST(
      request(`/api/sentences/${ownRecord.id}/comments`, { method: 'POST', body: { body: 'hi' } }),
      params({ sentenceId: ownRecord.id })
    )
    expect(res.status).toBe(401)
    expect(await prisma.comment.count()).toBe(0)
  })
})

describe('labeller scope', () => {
  it('queue and stats show only assigned records', async () => {
    signInAs(deep)
    const res = await queueRoute.GET(request('/api/sentences?limit=50'), params())
    expect(res.status).toBe(200)
    expect(ids(await res.json())).toEqual([ownRecord.id])

    const stats = await (await statsRoute.GET(request('/api/sentences/stats'), params())).json()
    expect(stats.stats.total).toBe(1)
  })

  it('cannot read or change a record assigned to someone else', async () => {
    signInAs(deep)
    const p = params({ sentenceId: otherRecord.id })
    expect((await detailRoute.GET(request(`/api/sentences/${otherRecord.id}`), p)).status).toBe(403)

    const annotate = await annotationsRoute.POST(
      request(`/api/sentences/${otherRecord.id}/annotations`, {
        method: 'POST',
        body: { annotations: [{ level: 1, nodeCode: '02', taxonomyKey: taxKey }], status: 'submitted' }
      }),
      p
    )
    expect(annotate.status).toBe(403)
    expect(await prisma.sentenceAnnotation.count({ where: { sentenceId: otherRecord.id } })).toBe(0)

    expect((await commentsRoute.GET(request(`/api/sentences/${otherRecord.id}/comments`), p)).status).toBe(403)
    expect(
      (
        await flagRoute.POST(
          request(`/api/sentences/${otherRecord.id}/flag`, { method: 'POST', body: { flagged: true } }),
          p
        )
      ).status
    ).toBe(403)
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: otherRecord.id } })).flagged).toBe(false)
  })

  it('bulk labelling with one foreign id is rejected as a whole', async () => {
    signInAs(deep)
    const res = await bulkRoute.POST(
      request('/api/sentences/bulk-label', {
        method: 'POST',
        body: {
          sentenceIds: [ownRecord.id, otherRecord.id],
          taxonomyKey: taxKey,
          annotations: [{ level: 1, nodeCode: '02' }]
        }
      }),
      params()
    )
    expect(res.status).toBe(403)
    expect(await prisma.sentenceAnnotation.count()).toBe(0)
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: ownRecord.id } })).status).toBe('pending')
  })

  it('can comment on its own record, authored as itself', async () => {
    signInAs(deep)
    const res = await commentsRoute.POST(
      request(`/api/sentences/${ownRecord.id}/comments`, { method: 'POST', body: { body: 'question' } }),
      params({ sentenceId: ownRecord.id })
    )
    expect(res.status).toBe(200)
    const comment = await prisma.comment.findFirstOrThrow({ where: { sentenceId: ownRecord.id } })
    expect(comment.authorId).toBe(deep.id)

    // Another user who can see the record may not delete it; an admin may.
    signInAs(s1)
    const del = (as: User) => {
      signInAs(as)
      return commentsRoute.DELETE(
        request(`/api/sentences/${ownRecord.id}/comments`, { method: 'DELETE', body: { commentId: comment.id } }),
        params({ sentenceId: ownRecord.id })
      )
    }
    expect((await del(s1)).status).toBe(403)
    expect((await del(admin)).status).toBe(200)
  })

  it('may only read its own user profile', async () => {
    signInAs(deep)
    expect((await userRoute.GET(request(`/api/users/${deep.id}`), params({ userId: deep.id }))).status).toBe(200)
    expect((await userRoute.GET(request(`/api/users/${other.id}`), params({ userId: other.id }))).status).toBe(403)
    expect((await usersRoute.GET(request('/'), params())).status).toBe(403)
  })
})

describe('supervisor scope', () => {
  it('sees records of the whole subtree, at any depth, and nothing else', async () => {
    signInAs(s1)
    const res = await queueRoute.GET(request('/api/sentences?limit=50'), params())
    expect(ids(await res.json())).toEqual([ownRecord.id])
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: ownRecord.id }))).status).toBe(200)
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: otherRecord.id }))).status).toBe(403)
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: unassigned.id }))).status).toBe(403)
  })

  it('lists only its own team', async () => {
    signInAs(s1)
    const body = await (await usersRoute.GET(request('/'), params())).json()
    expect(body.users.map((u: User) => u.id).sort()).toEqual([s1.id, s2.id, s3.id, deep.id, direct.id].sort())
  })

  it('cannot assign records or users outside its team', async () => {
    signInAs(s1)
    const assign = (sentenceIds: string[], userIds: string[]) =>
      assignRoute.POST(request('/api/sentences/assign', { method: 'POST', body: { sentenceIds, userIds } }), params())
    expect((await assign([otherRecord.id], [direct.id])).status).toBe(403)
    expect((await assign([unassigned.id], [direct.id])).status).toBe(403)
    expect((await assign([ownRecord.id], [other.id])).status).toBe(403)
    expect(await prisma.sentenceAssignment.count({ where: { membership: { userId: direct.id } } })).toBe(0)

    expect((await assign([ownRecord.id], [direct.id])).status).toBe(200)
    expect(
      await prisma.sentenceAssignment.count({ where: { sentenceId: ownRecord.id, membership: { userId: direct.id } } })
    ).toBe(1)
  })

  it('unassigning without userIds only removes its own team', async () => {
    await inWorkspace(async () =>
      db().sentenceAssignment.create({
        data: {
          workspaceId: wsId(),
          sentenceId: ownRecord.id,
          membershipId: (
            await prisma.workspaceMembership.findUniqueOrThrow({
              where: { workspaceId_userId: { workspaceId: wsId(), userId: other.id } }
            })
          ).id
        }
      })
    )
    signInAs(s1)
    expect(
      (
        await assignRoute.DELETE(
          request('/api/sentences/assign', {
            method: 'DELETE',
            body: { sentenceIds: [ownRecord.id], userIds: [other.id] }
          }),
          params()
        )
      ).status
    ).toBe(403)

    const res = await assignRoute.DELETE(
      request('/api/sentences/assign', {
        method: 'DELETE',
        body: { sentenceIds: [ownRecord.id] }
      }),
      params()
    )
    expect(res.status).toBe(200)
    const remaining = await prisma.sentenceAssignment.findMany({
      where: { sentenceId: ownRecord.id },
      include: { membership: true }
    })
    expect(remaining.map(a => a.membership.userId)).toEqual([other.id])

    // Restore the fixture for later tests.
    await prisma.sentenceAssignment.deleteMany({ where: { sentenceId: ownRecord.id } })
    await inWorkspace(async () =>
      db().sentenceAssignment.create({
        data: {
          workspaceId: wsId(),
          sentenceId: ownRecord.id,
          membershipId: (
            await prisma.workspaceMembership.findUniqueOrThrow({
              where: { workspaceId_userId: { workspaceId: wsId(), userId: deep.id } }
            })
          ).id
        }
      })
    )
  })

  it('progress counts only the subtree', async () => {
    signInAs(t1)
    const res = await progressOverviewRoute.GET(
      request('/api/progress/overview?startDate=2020-01-01&endDate=2021-12-31'),
      params()
    )
    expect(res.status).toBe(200)
    expect((await res.json()).workload.total).toBe(1)
    expect(
      (await progressOverviewRoute.GET(request('/api/progress/overview?startDate=nope&endDate=2021-01-01'), params()))
        .status
    ).toBe(400)
  })
})

describe('session lifecycle', () => {
  it('a deleted user is signed out', async () => {
    const gone = await createUser('labeller')
    await prisma.user.delete({ where: { id: gone.id } })
    signInAs(gone)
    expect((await queueRoute.GET(request('/api/sentences'), params())).status).toBe(401)
  })

  it('a demoted admin loses admin APIs immediately', async () => {
    const formerAdmin = await createUser('labeller')
    signInAs({ id: formerAdmin.id, role: 'admin' }) // the caller still thinks they are admin
    expect((await exportRoute.GET(request('/api/export'), params())).status).toBe(403)
  })

  it('a password reset by an admin ends existing sessions', async () => {
    const user = await createUser('labeller')
    signInAs(admin)
    const res = await userRoute.PUT(
      request(`/api/users/${user.id}`, { method: 'PUT', body: { newPassword: 'temporary-123' } }),
      params({ userId: user.id })
    )
    expect(res.status).toBe(200)
    signInAs(user) // the session from before the reset
    expect((await queueRoute.GET(request('/api/sentences'), params())).status).toBe(401)
  })

  it('users who must reset their password can only reach the reset endpoint', async () => {
    const user = await createUser('labeller', { mustResetPassword: true })
    signInAs(user)
    const res = await queueRoute.GET(request('/api/sentences'), params())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PASSWORD_RESET_REQUIRED')

    // Reaches the handler (wrong current password -> 400, not 401/403).
    const reset = await resetPasswordRoute.POST(
      request('/api/auth/reset-password', {
        method: 'POST',
        body: { currentPassword: 'wrong', newPassword: 'new-password-1' }
      })
    )
    expect(reset.status).toBe(400)
  })
})

describe('user administration rules', () => {
  it('rejects supervisor cycles and self-supervision', async () => {
    signInAs(admin)
    const put = (userId: string, supervisorId: string) =>
      userRoute.PUT(request(`/api/users/${userId}`, { method: 'PUT', body: { supervisorId } }), params({ userId }))
    expect((await put(s1.id, s3.id)).status).toBe(400)
    expect((await put(s1.id, s1.id)).status).toBe(400)
    expect((await put(s1.id, deep.id)).status).toBe(400) // labellers cannot supervise
    expect(
      (
        await prisma.workspaceMembership.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: wsId(), userId: s1.id } }
        })
      ).supervisorMembershipId
    ).toBeNull()
  })

  it('keeps at least one admin', async () => {
    signInAs(admin)
    const res = await userRoute.PUT(
      request(`/api/users/${admin.id}`, { method: 'PUT', body: { role: 'labeller' } }),
      params({ userId: admin.id })
    )
    expect(res.status).toBe(400)
    expect(
      (
        await prisma.workspaceMembership.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: wsId(), userId: admin.id } }
        })
      ).role
    ).toBe('admin')
  })
})

describe('user deletion', () => {
  it('removing from a workspace suspends the membership and keeps the account', async () => {
    const leaver = await createUser('labeller')
    signInAs(admin)
    const res = await userRoute.DELETE(
      request(`/api/users/${leaver.id}`, { method: 'DELETE' }),
      params({ userId: leaver.id })
    )
    expect(res.status).toBe(200)
    expect(
      (
        await prisma.workspaceMembership.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: wsId(), userId: leaver.id } }
        })
      ).status
    ).toBe('suspended')
    expect(await prisma.user.count({ where: { id: leaver.id } })).toBe(1)
    signInAs(leaver)
    expect((await queueRoute.GET(request('/api/sentences'), params())).status).toBe(404)
  })

  it('refuses to delete a comment author with 409 and deletes others (platform admins)', async () => {
    const author = await createUser('labeller')
    const [record] = await createSentences(1, [author.id])
    await inWorkspace(() =>
      db().comment.create({ data: { workspaceId: wsId(), sentenceId: record.id, authorId: author.id, body: 'kept' } })
    )
    const plain = await createUser('labeller')

    signInAs(admin)
    const del = (userId: string) =>
      accountRoute.DELETE(request(`/api/users/${userId}`, { method: 'DELETE' }), plainParams({ userId }))
    expect((await del(author.id)).status).toBe(409)
    expect(await prisma.user.count({ where: { id: author.id } })).toBe(1)
    expect((await del(plain.id)).status).toBe(200)
    expect(await prisma.user.count({ where: { id: plain.id } })).toBe(0)
  })
})
