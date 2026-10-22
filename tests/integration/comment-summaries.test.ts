import { beforeAll, expect, it } from 'vitest'
import {
  createWorkspace,
  createUser,
  createSentences,
  resetDatabase,
  signInAs,
  prisma,
  wsId,
  params,
  request
} from './helpers'
import * as queue from '@/app/api/workspaces/[workspaceId]/sentences/route'
import * as detail from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/route'
import * as comments from '@/app/api/workspaces/[workspaceId]/sentences/[sentenceId]/comments/route'

let recordId: string
let hiddenId: string
let authorId: string
beforeAll(async () => {
  await resetDatabase()
  await createWorkspace()
  const admin = await createUser('admin')
  const labeller = await createUser('labeller')
  authorId = admin.id
  const [visible] = await createSentences(1, [labeller.id])
  const [hidden] = await createSentences(1)
  recordId = visible.id
  hiddenId = hidden.id
  await prisma.comment.createMany({
    data: [
      { workspaceId: wsId(), sentenceId: recordId, authorId, body: 'Open discussion' },
      { workspaceId: wsId(), sentenceId: recordId, authorId, body: 'Resolved discussion', resolved: true },
      { workspaceId: wsId(), sentenceId: hiddenId, authorId, body: 'Hidden discussion' }
    ]
  })
  signInAs(labeller)
})

it('reports identical summaries in the queue, detail and filtered thread without exposing comment bodies in the queue', async () => {
  const list = await (await queue.GET(request('/x?limit=100'), params())).json()
  expect(list.sentences).toHaveLength(1)
  expect(list.sentences[0].commentSummary).toEqual({ total: 2, unresolved: 1 })
  expect(list.sentences[0].comments).toBeUndefined()
  const record = await (await detail.GET(request('/x'), params({ sentenceId: recordId }))).json()
  expect(record.commentSummary).toEqual({ total: 2, unresolved: 1 })
  for (const includeResolved of [false, true]) {
    const result = await (
      await comments.GET(request(`/x?includeResolved=${includeResolved}`), params({ sentenceId: recordId }))
    ).json()
    expect(result.commentSummary).toEqual({ total: 2, unresolved: 1 })
    expect(result.comments).toHaveLength(includeResolved ? 2 : 1)
    expect(result.hasResolved).toBe(true)
  }
  expect((await comments.GET(request('/x'), params({ sentenceId: hiddenId }))).status).toBe(403)
})

it('updates the summary after resolving, reopening and deleting, without creating labeling activity', async () => {
  const result = await (
    await comments.POST(
      request('/x', { method: 'POST', body: { body: 'New question' } }),
      params({ sentenceId: recordId })
    )
  ).json()
  const id = result.comment.id
  for (const resolved of [true, false]) {
    expect(
      (
        await comments.PATCH(
          request('/x', { method: 'PATCH', body: { commentId: id, resolved } }),
          params({ sentenceId: recordId })
        )
      ).status
    ).toBe(200)
    const record = await (await detail.GET(request('/x'), params({ sentenceId: recordId }))).json()
    expect(record.commentSummary).toEqual({ total: 3, unresolved: resolved ? 1 : 2 })
  }
  expect(
    (
      await comments.DELETE(
        request('/x', { method: 'DELETE', body: { commentId: id } }),
        params({ sentenceId: recordId })
      )
    ).status
  ).toBe(200)
  const record = await (await detail.GET(request('/x'), params({ sentenceId: recordId }))).json()
  expect(record.commentSummary).toEqual({ total: 2, unresolved: 1 })
  expect(await prisma.labelingActivity.count()).toBe(0)
})
