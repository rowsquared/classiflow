import { beforeAll, describe, expect, it } from 'vitest'
import type { Sentence, User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createSentences, createTaxonomy, createUser, params, request, resetDatabase, signInAs } from './helpers'

import * as queueRoute from '@/app/api/sentences/route'
import * as statsRoute from '@/app/api/sentences/stats/route'
import * as detailRoute from '@/app/api/sentences/[sentenceId]/route'
import * as annotationsRoute from '@/app/api/sentences/[sentenceId]/annotations/route'
import * as bulkRoute from '@/app/api/sentences/bulk-label/route'
import * as commentsRoute from '@/app/api/sentences/[sentenceId]/comments/route'
import * as flagRoute from '@/app/api/sentences/[sentenceId]/flag/route'
import * as assignRoute from '@/app/api/sentences/assign/route'
import * as usersRoute from '@/app/api/users/route'
import * as userRoute from '@/app/api/users/[userId]/route'
import * as exportRoute from '@/app/api/export/route'
import * as resetPasswordRoute from '@/app/api/auth/reset-password/route'
import * as progressStatsRoute from '@/app/api/progress/stats/route'
import * as taxonomiesRoute from '@/app/api/taxonomies/route'

// Team tree:  admin
//             s1 (supervisor) -> s2 (supervisor) -> s3 (supervisor) -> deep (labeller)
//                             -> direct (labeller)
//             t1 (supervisor) -> other (labeller)
let admin: User, s1: User, s2: User, s3: User, deep: User, direct: User, t1: User, other: User
let ownRecord: Sentence, otherRecord: Sentence, unassigned: Sentence
let taxKey: string

beforeAll(async () => {
  await resetDatabase()
  admin = await createUser('admin')
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
    expect((await queueRoute.GET(request('/api/sentences'))).status).toBe(401)
    expect((await taxonomiesRoute.GET()).status).toBe(401)
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
    const res = await queueRoute.GET(request('/api/sentences?limit=50'))
    expect(res.status).toBe(200)
    expect(ids(await res.json())).toEqual([ownRecord.id])

    const stats = await (await statsRoute.GET(request('/api/sentences/stats'))).json()
    expect(stats.stats.total).toBe(1)
  })

  it('cannot read or change a record assigned to someone else', async () => {
    signInAs(deep)
    const p = params({ sentenceId: otherRecord.id })
    expect((await detailRoute.GET(request(`/api/sentences/${otherRecord.id}`), p)).status).toBe(403)

    const annotate = await annotationsRoute.POST(
      request(`/api/sentences/${otherRecord.id}/annotations`, {
        method: 'POST',
        body: { annotations: [{ level: 1, nodeCode: '02', taxonomyKey: taxKey }], status: 'submitted' },
      }),
      p
    )
    expect(annotate.status).toBe(403)
    expect(await prisma.sentenceAnnotation.count({ where: { sentenceId: otherRecord.id } })).toBe(0)

    expect((await commentsRoute.GET(request(`/api/sentences/${otherRecord.id}/comments`), p)).status).toBe(403)
    expect((await flagRoute.POST(
      request(`/api/sentences/${otherRecord.id}/flag`, { method: 'POST', body: { flagged: true } }), p
    )).status).toBe(403)
    expect((await prisma.sentence.findUniqueOrThrow({ where: { id: otherRecord.id } })).flagged).toBe(false)
  })

  it('bulk labelling with one foreign id is rejected as a whole', async () => {
    signInAs(deep)
    const res = await bulkRoute.POST(request('/api/sentences/bulk-label', {
      method: 'POST',
      body: {
        sentenceIds: [ownRecord.id, otherRecord.id],
        taxonomyKey: taxKey,
        annotations: [{ level: 1, nodeCode: '02' }],
      },
    }))
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
    expect((await usersRoute.GET()).status).toBe(403)
  })
})

describe('supervisor scope', () => {
  it('sees records of the whole subtree, at any depth, and nothing else', async () => {
    signInAs(s1)
    const res = await queueRoute.GET(request('/api/sentences?limit=50'))
    expect(ids(await res.json())).toEqual([ownRecord.id])
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: ownRecord.id }))).status).toBe(200)
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: otherRecord.id }))).status).toBe(403)
    expect((await detailRoute.GET(request('/x'), params({ sentenceId: unassigned.id }))).status).toBe(403)
  })

  it('lists only its own team', async () => {
    signInAs(s1)
    const body = await (await usersRoute.GET()).json()
    expect(body.users.map((u: User) => u.id).sort()).toEqual([s1.id, s2.id, s3.id, deep.id, direct.id].sort())
  })

  it('cannot assign records or users outside its team', async () => {
    signInAs(s1)
    const assign = (sentenceIds: string[], userIds: string[]) =>
      assignRoute.POST(request('/api/sentences/assign', { method: 'POST', body: { sentenceIds, userIds } }))
    expect((await assign([otherRecord.id], [direct.id])).status).toBe(403)
    expect((await assign([unassigned.id], [direct.id])).status).toBe(403)
    expect((await assign([ownRecord.id], [other.id])).status).toBe(403)
    expect(await prisma.sentenceAssignment.count({ where: { userId: direct.id } })).toBe(0)

    expect((await assign([ownRecord.id], [direct.id])).status).toBe(200)
    expect(await prisma.sentenceAssignment.count({ where: { sentenceId: ownRecord.id, userId: direct.id } })).toBe(1)
  })

  it('unassigning without userIds only removes its own team', async () => {
    await prisma.sentenceAssignment.create({ data: { sentenceId: ownRecord.id, userId: other.id } })
    signInAs(s1)
    expect((await assignRoute.DELETE(request('/api/sentences/assign', {
      method: 'DELETE', body: { sentenceIds: [ownRecord.id], userIds: [other.id] },
    }))).status).toBe(403)

    const res = await assignRoute.DELETE(request('/api/sentences/assign', {
      method: 'DELETE', body: { sentenceIds: [ownRecord.id] },
    }))
    expect(res.status).toBe(200)
    const remaining = await prisma.sentenceAssignment.findMany({ where: { sentenceId: ownRecord.id } })
    expect(remaining.map(a => a.userId)).toEqual([other.id])

    // Restore the fixture for later tests.
    await prisma.sentenceAssignment.deleteMany({ where: { sentenceId: ownRecord.id } })
    await prisma.sentenceAssignment.create({ data: { sentenceId: ownRecord.id, userId: deep.id } })
  })

  it('progress stats count only the subtree', async () => {
    signInAs(t1)
    const res = await progressStatsRoute.GET(request('/api/progress/stats?startDate=2020-01-01&endDate=2100-01-01'))
    expect(res.status).toBe(200)
    expect((await res.json()).metrics.completion.total).toBe(1)
    expect((await progressStatsRoute.GET(request('/api/progress/stats?startDate=nope&endDate=2100-01-01'))).status).toBe(400)
  })
})

describe('session lifecycle', () => {
  it('a deleted user is signed out', async () => {
    const gone = await createUser('labeller')
    await prisma.user.delete({ where: { id: gone.id } })
    signInAs(gone)
    expect((await queueRoute.GET(request('/api/sentences'))).status).toBe(401)
  })

  it('a demoted admin loses admin APIs immediately', async () => {
    const formerAdmin = await createUser('labeller')
    signInAs({ id: formerAdmin.id, role: 'admin' }) // JWT still says admin
    expect((await exportRoute.GET(request('/api/export'))).status).toBe(403)
  })

  it('a password reset by an admin ends existing sessions', async () => {
    const user = await createUser('labeller')
    signInAs(admin)
    const res = await userRoute.PUT(
      request(`/api/users/${user.id}`, { method: 'PUT', body: { newPassword: 'temporary-123' } }),
      params({ userId: user.id })
    )
    expect(res.status).toBe(200)
    signInAs(user) // token from before the reset: sessionVersion 0
    expect((await queueRoute.GET(request('/api/sentences'))).status).toBe(401)
  })

  it('users who must reset their password can only reach the reset endpoint', async () => {
    const user = await createUser('labeller', { mustResetPassword: true })
    signInAs(user)
    const res = await queueRoute.GET(request('/api/sentences'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PASSWORD_RESET_REQUIRED')

    // Reaches the handler (wrong current password -> 400, not 401/403).
    const reset = await resetPasswordRoute.POST(request('/api/auth/reset-password', {
      method: 'POST', body: { currentPassword: 'wrong', newPassword: 'new-password-1' },
    }))
    expect(reset.status).toBe(400)
  })
})

describe('user administration rules', () => {
  it('rejects supervisor cycles and self-supervision', async () => {
    signInAs(admin)
    const put = (userId: string, supervisorId: string) => userRoute.PUT(
      request(`/api/users/${userId}`, { method: 'PUT', body: { supervisorId } }),
      params({ userId })
    )
    expect((await put(s1.id, s3.id)).status).toBe(400)
    expect((await put(s1.id, s1.id)).status).toBe(400)
    expect((await put(s1.id, deep.id)).status).toBe(400) // labellers cannot supervise
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s1.id } })).supervisorId).toBeNull()
  })

  it('keeps at least one admin', async () => {
    signInAs(admin)
    const res = await userRoute.PUT(
      request(`/api/users/${admin.id}`, { method: 'PUT', body: { role: 'labeller' } }),
      params({ userId: admin.id })
    )
    expect(res.status).toBe(400)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('admin')
  })
})
