import 'server-only'
import { createHash, randomInt } from 'node:crypto'
import { getVisibleMembershipIds } from '@/lib/access'
import { lockSentences } from '@/lib/annotation-status'
import { audit } from '@/lib/audit'
import type { CurrentUser } from '@/lib/api-auth'
import type { DistributionPreview, DistributionRequest, DistributionResult } from '@/lib/contracts/distribution'
import { Prisma } from '@/lib/generated/prisma/client'
import { loadQueueUrlState, queueMatchParams } from '@/lib/queue-url'
import { PARTICIPATING, sampleRecords } from '@/lib/server/double-annotation'
import { queueFilterError, queueSelectionWhere } from '@/lib/server/sentences'
import { lockWorkspaceAdmins } from '@/lib/user-rules'
import { db } from '@/lib/workspace/db'

const MAX_RECORDS = 50_000
const BATCH_SIZE = 1_000
const ENTITY_TYPE = 'distribution'
const ACTION = 'assignments.distributed'

export class DistributionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409
  ) {
    super(message)
  }
}

function changedSelection(): never {
  throw new DistributionError('Records, labellers or workloads changed. Preview the distribution again.', 409)
}

async function availableLabellers(user: CurrentUser, ids?: string[]) {
  const scope = await getVisibleMembershipIds(user)
  return db().workspaceMembership.findMany({
    where: {
      workspaceId: user.workspaceId,
      ...(scope === null ? {} : { id: { in: scope } }),
      ...(ids ? { userId: { in: ids } } : {}),
      role: 'labeller',
      status: 'active',
      user: { OR: [{ banned: false }, { banned: null }, { banExpires: { lte: new Date() } }] }
    },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
    orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }]
  })
}

export async function getDistributionLabellers(user: CurrentUser) {
  return (await availableLabellers(user)).map(({ userId, user }) => ({
    id: userId,
    name: user.name || user.email,
    email: user.email
  }))
}

const eligibleRecord = {
  status: { in: ['pending', 'escalated'] },
  assignments: { none: { membership: { role: 'labeller', status: 'active' } } },
  doubleRounds: { none: { status: 'active' } },
  doubleTasks: { none: PARTICIPATING }
} satisfies Prisma.SentenceWhereInput

async function recordIds(where: Prisma.SentenceWhereInput) {
  const records = await db().sentence.findMany({
    where,
    select: { id: true },
    orderBy: { id: 'asc' },
    take: MAX_RECORDS + 1
  })
  return records.map(record => record.id)
}

/** Open ordinary records and unfinished active double parts. Participant access is not a second assignment. */
async function getOpenWork(workspaceId: string, membershipIds: string[]) {
  const rows = await db().$queryRaw<Array<{ id: string; open: number }>>`
    WITH people AS (
      SELECT id, "userId" FROM "WorkspaceMembership"
      WHERE "workspaceId" = ${workspaceId} AND id IN (${Prisma.join(membershipIds)})
    ), ordinary AS (
      SELECT a."membershipId" AS id, count(*) AS open
      FROM "SentenceAssignment" a JOIN people p ON p.id = a."membershipId"
      JOIN "Sentence" s ON s.id = a."sentenceId" AND s."workspaceId" = a."workspaceId"
      WHERE a."workspaceId" = ${workspaceId} AND s.status IN ('pending', 'escalated')
        AND NOT EXISTS (
          SELECT 1 FROM "DoubleRound" r WHERE r."workspaceId" = s."workspaceId"
            AND r."sentenceId" = s.id AND r.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "DoubleTask" t WHERE t."workspaceId" = s."workspaceId"
            AND t."sentenceId" = s.id AND t."assigneeId" = p."userId"
            AND t.status <> 'cancelled' AND t."releasedAt" IS NULL
        )
      GROUP BY a."membershipId"
    ), independent AS (
      SELECT p.id, count(*) AS open
      FROM "DoubleTask" t JOIN people p ON p."userId" = t."assigneeId"
      JOIN "DoubleRound" r ON r.id = t."roundId" AND r."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND r.status = 'active'
        AND t.status IN ('pending', 'skipped') AND t."releasedAt" IS NULL
      GROUP BY p.id
    )
    SELECT p.id, (coalesce(o.open, 0) + coalesce(i.open, 0))::int AS open
    FROM people p LEFT JOIN ordinary o ON o.id = p.id LEFT JOIN independent i ON i.id = p.id`
  return new Map(rows.map(({ id, open }) => [id, open]))
}

function allocate(
  ids: string[],
  people: Array<{ id: string; open: number }>,
  mode: DistributionRequest['mode'],
  seed: number
) {
  const counts = new Map(people.map(person => [person.id, mode === 'workload' ? person.open : 0]))
  const order = sampleRecords(
    people.map(person => person.id),
    100,
    seed
  )
  const assignments = sampleRecords(ids, 100, seed).map(sentenceId => {
    let membershipId = order[0]!
    for (const candidate of order) {
      if (counts.get(candidate)! < counts.get(membershipId)!) membershipId = candidate
    }
    counts.set(membershipId, counts.get(membershipId)! + 1)
    return { sentenceId, membershipId }
  })
  return { assignments, counts }
}

/** All writes, including the receipt used for retries, commit together in the workspace transaction. */
export async function distributeWork(
  user: CurrentUser,
  { queue, labellerIds, mode, confirmation }: DistributionRequest
): Promise<DistributionPreview | DistributionResult> {
  const params = new URLSearchParams(queueMatchParams(await loadQueueUrlState(new URLSearchParams(queue))))
  const filterError = queueFilterError(params)
  if (filterError) throw new DistributionError(filterError, 400)
  if (new Set(labellerIds).size !== labellerIds.length) {
    throw new DistributionError('Choose distinct labellers.', 400)
  }

  if (confirmation) {
    // Serialize distributions and team/membership edits in the workspace.
    await lockWorkspaceAdmins(user.workspaceId)
    if (user.authority === 'membership') {
      const stillAllowed = await db().workspaceMembership.findFirst({
        where: { id: user.membershipId!, userId: user.id, role: user.role, status: 'active' },
        select: { id: true }
      })
      if (!stillAllowed) throw new DistributionError('Your workspace role changed. Reopen Distribute work.', 403)
    }
    const receipt = await db().auditLog.findFirst({
      where: { action: ACTION, actorId: user.id, entityType: ENTITY_TYPE, entityId: confirmation.fingerprint },
      select: { payload: true }
    })
    const payload = receipt?.payload
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.records === 'number') {
      return { assigned: payload.records }
    }
  }

  const labellers = await availableLabellers(user, labellerIds)
  if (labellers.length !== labellerIds.length) {
    throw new DistributionError('Choose active labellers you can assign work to.', 403)
  }
  let base = await queueSelectionWhere(user, params)
  const where = { AND: [base, eligibleRecord] }
  const ids = await recordIds(where)
  if (confirmation) {
    if (ids.length === 0 || ids.length > MAX_RECORDS) changedSelection()
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BATCH_SIZE)
      await lockSentences(db(), batch)
      // Assignment inserts need the parent record lock. Guard existing access rows against concurrent removal.
      await db().$queryRaw`SELECT id FROM "SentenceAssignment"
        WHERE "workspaceId" = ${user.workspaceId} AND "sentenceId" IN (${Prisma.join(batch)})
        ORDER BY id FOR UPDATE`
    }
    base = await queueSelectionWhere(user, params)
    const current = await recordIds({ AND: [base, eligibleRecord] })
    if (current.length !== ids.length || current.some((id, index) => id !== ids[index])) changedSelection()
  }

  const matched = await db().sentence.count({ where: base })
  const open = await getOpenWork(
    user.workspaceId,
    labellers.map(labeller => labeller.id)
  )
  const loads = labellers.map(labeller => ({ id: labeller.id, open: open.get(labeller.id) ?? 0 }))
  if (ids.length === 0 || ids.length > MAX_RECORDS) {
    return {
      matched,
      eligible: ids.length === 0 ? 0 : await db().sentence.count({ where }),
      maxRecords: MAX_RECORDS,
      people: labellers.map(labeller => ({ id: labeller.userId, open: open.get(labeller.id) ?? 0, added: 0 })),
      confirmation: null
    }
  }

  const seed = confirmation?.seed ?? randomInt(1, 2_147_483_647)
  const { assignments, counts } = allocate(ids, loads, mode, seed)
  const people = labellers.map(labeller => {
    const current = open.get(labeller.id) ?? 0
    return { id: labeller.userId, open: current, added: counts.get(labeller.id)! - (mode === 'workload' ? current : 0) }
  })
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        user.workspaceId,
        user.id,
        user.role,
        params.toString(),
        mode,
        seed,
        matched,
        people,
        assignments
      ])
    )
    .digest('hex')
  if (!confirmation) {
    return { matched, eligible: ids.length, maxRecords: MAX_RECORDS, people, confirmation: { seed, fingerprint } }
  }
  if (confirmation.fingerprint !== fingerprint) changedSelection()

  for (let offset = 0; offset < assignments.length; offset += BATCH_SIZE) {
    await db().sentenceAssignment.createMany({
      data: assignments.slice(offset, offset + BATCH_SIZE).map(assignment => ({
        ...assignment,
        workspaceId: user.workspaceId,
        assignedBy: user.id
      }))
    })
  }
  await audit({
    actorId: user.id,
    action: ACTION,
    entityType: ENTITY_TYPE,
    entityId: fingerprint,
    payload: {
      records: assignments.length,
      mode,
      people: people.map(({ id, added }) => ({ userId: id, records: added }))
    }
  })
  return { assigned: assignments.length }
}
