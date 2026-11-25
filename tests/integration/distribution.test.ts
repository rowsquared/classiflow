import { beforeEach, describe, expect, it } from 'vitest'
import { POST } from '@/app/api/workspaces/[workspaceId]/sentences/assign/distribute/route'
import type { DistributionPreview, DistributionRequest } from '@/lib/contracts/distribution'
import {
  createSentences,
  createUser,
  createWorkspace,
  params,
  prisma,
  request,
  resetDatabase,
  signInAs
} from './helpers'

const distribute = (body: DistributionRequest) =>
  POST(request('/sentences/assign/distribute', { method: 'POST', body }), params())

async function preview(body: DistributionRequest): Promise<DistributionPreview> {
  const response = await distribute(body)
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
})

describe('distributing filtered work', () => {
  it('splits the entire filtered import evenly and commits the preview once', async () => {
    const admin = await createUser('admin')
    const labellers = await Promise.all(Array.from({ length: 3 }, () => createUser('labeller')))
    const records = await createSentences(7)
    await createSentences(2)
    signInAs(admin)
    const body: DistributionRequest = {
      queue: `?importId=${records[0].importId}&limit=1&page=2`,
      labellerIds: labellers.map(person => person.id),
      mode: 'even'
    }
    const plan = await preview(body)
    expect(plan).toMatchObject({ matched: 7, eligible: 7 })
    expect(plan.people.map(person => person.added).sort()).toEqual([2, 2, 3])
    expect(await prisma.sentenceAssignment.count()).toBe(0)

    const confirm = { ...body, confirmation: plan.confirmation! }
    const responses = await Promise.all([distribute(confirm), distribute(confirm)])
    for (const response of responses) {
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual({ assigned: 7 })
    }
    const assignments = await prisma.sentenceAssignment.findMany({
      include: { membership: { select: { userId: true } } }
    })
    expect(assignments.map(row => row.sentenceId).sort()).toEqual(records.map(record => record.id).sort())
    for (const person of plan.people) {
      expect(assignments.filter(row => row.membership.userId === person.id)).toHaveLength(person.added)
    }
    expect(await prisma.auditLog.count({ where: { action: 'assignments.distributed' } })).toBe(1)
  })

  it('accounts for unfinished double parts and refuses a stale workload preview', async () => {
    const admin = await createUser('admin')
    const busy = await createUser('labeller')
    const other = await createUser('labeller')
    const [open, independent] = await createSentences(2, [busy.id])
    const round = await prisma.doubleRound.create({
      data: { workspaceId: independent.workspaceId, sentenceId: independent.id, status: 'active' }
    })
    await prisma.doubleTask.create({
      data: {
        workspaceId: independent.workspaceId,
        sentenceId: independent.id,
        roundId: round.id,
        position: 1,
        assigneeId: busy.id
      }
    })
    const [eligible, submitted] = await createSentences(2)
    await prisma.sentence.update({ where: { id: submitted.id }, data: { status: 'submitted' } })
    signInAs(admin)
    const body: DistributionRequest = { queue: '?tab=all', labellerIds: [busy.id, other.id], mode: 'workload' }
    const plan = await preview(body)
    expect(plan).toMatchObject({ matched: 4, eligible: 1 })
    expect(plan.people).toEqual(
      expect.arrayContaining([
        { id: busy.id, open: 2, added: 0 },
        { id: other.id, open: 0, added: 1 }
      ])
    )

    await prisma.sentence.update({ where: { id: open.id }, data: { status: 'submitted' } })
    expect((await distribute({ ...body, confirmation: plan.confirmation! })).status).toBe(409)
    expect(await prisma.sentenceAssignment.count({ where: { sentenceId: eligible.id } })).toBe(0)
    const current = await preview(body)
    const response = await distribute({ ...body, confirmation: current.confirmation! })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ assigned: 1 })
    expect(await prisma.sentenceAssignment.count({ where: { sentenceId: submitted.id } })).toBe(0)
    expect(await prisma.sentenceAssignment.count({ where: { sentenceId: independent.id } })).toBe(1)
  })

  it('restricts the records and labellers a supervisor can distribute', async () => {
    const supervisor = await createUser('supervisor')
    const first = await createUser('labeller', { supervisorId: supervisor.id })
    const second = await createUser('labeller', { supervisorId: supervisor.id })
    const outside = await createUser('labeller')
    const [visible] = await createSentences(1, [supervisor.id])
    await createSentences(1)
    signInAs(supervisor)
    const body: DistributionRequest = { queue: '', labellerIds: [first.id, second.id], mode: 'even' }
    expect((await distribute({ ...body, labellerIds: [first.id, outside.id] })).status).toBe(403)
    const plan = await preview(body)
    expect(plan).toMatchObject({ matched: 1, eligible: 1 })
    expect((await distribute({ ...body, confirmation: plan.confirmation! })).status).toBe(200)
    const added = await prisma.sentenceAssignment.findMany({ where: { assignedBy: supervisor.id } })
    expect(added.map(row => row.sentenceId)).toEqual([visible.id])
    signInAs(first)
    expect((await distribute(body)).status).toBe(403)
  })
})
