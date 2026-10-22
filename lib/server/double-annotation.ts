import 'server-only'
import { db, scopeWorkspaceId } from '@/lib/workspace/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { visibleMembers } from '@/lib/access'
import { sameLabels, type LabelInput } from '@/lib/label-path'
import {
  compareAnswers,
  isConfirmed,
  summarizeOutcomes,
  type OutcomeState,
  type RoundSummary
} from '@/lib/double-annotation'
import { recordLabelingActivity } from '@/lib/labeling-activity'

/**
 * Double annotation workflow (prisma/schema.prisma DoubleRound and friends,
 * rules in lib/double-annotation.ts). Every function runs inside the
 * workspace transaction (db()); writers lock the record first
 * (lockSentences in lib/annotation-status.ts), so saves, reviews and manager
 * actions on one record run one after the other.
 *
 * SentenceAnnotation stays the record's current result (what the queue,
 * export and learning read): the first answer while waiting or disagreeing,
 * the agreed or reviewed path when confirmed. Sentence.status is `submitted`
 * only once every required taxonomy is confirmed.
 */

export class DoubleAnnotationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message)
  }
}

const roundInclude = {
  tasks: { where: { status: { not: 'cancelled' } }, orderBy: { position: 'asc' } },
  outcomes: true
} satisfies Prisma.DoubleRoundInclude

export type ActiveRound = Prisma.DoubleRoundGetPayload<{ include: typeof roundInclude }>
type Task = ActiveRound['tasks'][number]

export async function activeRound(sentenceId: string): Promise<ActiveRound | null> {
  return db().doubleRound.findFirst({ where: { sentenceId, status: 'active' }, include: roundInclude })
}

/**
 * How `user` meets a record in double annotation:
 * - task: they label it (blind: only their own answer, no AI, no others' comments);
 * - manager: admin or supervisor who is not one of its labellers;
 * - hidden: anyone else with access (a labeller assigned before the round),
 *   who sees no labels and cannot label it.
 */
export type DoubleView =
  | { mode: 'task'; round: ActiveRound; task: Task }
  | { mode: 'manager'; round: ActiveRound }
  | { mode: 'hidden'; round: ActiveRound }

export function viewFor(user: CurrentUser, round: ActiveRound): DoubleView {
  const task = round.tasks.find(t => t.assigneeId === user.id)
  if (task) return { mode: 'task', round, task }
  if (user.role === 'admin' || user.role === 'supervisor') return { mode: 'manager', round }
  return { mode: 'hidden', round }
}

export async function doubleViewFor(user: CurrentUser, sentenceId: string): Promise<DoubleView | null> {
  const round = await activeRound(sentenceId)
  return round ? viewFor(user, round) : null
}

/**
 * A manager may decide a disagreement unless they labelled the record
 * themselves. Supervisors must manage every labeller of the round (their
 * subtree); a labeller without a known account needs an admin.
 */
export async function canReview(user: CurrentUser, round: ActiveRound): Promise<boolean> {
  if (user.role !== 'admin' && user.role !== 'supervisor') return false
  if (round.tasks.some(t => t.assigneeId === user.id)) return false
  const members = await visibleMembers(user)
  if (members === null) return true
  const team = new Set(members.map(m => m.userId))
  return round.tasks.every(t => t.assigneeId !== null && team.has(t.assigneeId))
}

async function taskLabels(taskIds: string[], taxonomyId?: string) {
  if (taskIds.length === 0) return []
  return db().doubleTaskLabel.findMany({
    where: { taskId: { in: taskIds }, ...(taxonomyId ? { taxonomyId } : {}) },
    select: { taskId: true, taxonomyId: true, level: true, nodeCode: true },
    orderBy: { level: 'asc' }
  })
}

/** Replaces the record's current result for one taxonomy. */
async function writeResult(
  sentenceId: string,
  taxonomyId: string,
  labels: LabelInput[],
  createdById: string | null,
  labelingStartedAt: Date | null
) {
  const tx = db()
  await tx.sentenceAnnotation.deleteMany({ where: { sentenceId, taxonomyId } })
  await tx.sentenceAnnotation.createMany({
    data: labels.map(l => ({
      workspaceId: scopeWorkspaceId(),
      sentenceId,
      taxonomyId,
      level: l.level,
      nodeCode: l.nodeCode,
      source: 'user' as const,
      createdById,
      labelingStartedAt
    }))
  })
}

/** A newly confirmed path counts for learning once (label rows, as for ordinary saves). */
async function countForLearning(taxonomyId: string, rows: number) {
  if (rows === 0) return
  await db().taxonomy.update({
    where: { id: taxonomyId },
    data: { newAnnotationsSinceLastLearning: { increment: rows } }
  })
}

/**
 * Completes the round once every required taxonomy is confirmed and returns
 * the record status it implies (submitted when confirmed, else pending).
 */
async function settleRound(roundId: string): Promise<{ summary: RoundSummary; status: 'submitted' | 'pending' }> {
  const outcomes = await db().doubleOutcome.findMany({ where: { roundId }, select: { state: true } })
  const summary = summarizeOutcomes(outcomes.map(o => o.state as OutcomeState))
  if (summary === 'confirmed') {
    await db().doubleRound.update({ where: { id: roundId }, data: { status: 'completed', closedAt: new Date() } })
  }
  return { summary, status: summary === 'confirmed' ? 'submitted' : 'pending' }
}

export type TaskSaveResult = {
  /** The record's status after the save. */
  recordStatus: 'submitted' | 'pending'
  /** The caller's own task: taxonomies they answered and whether every one is done. */
  answeredTaxonomyIds: Set<string>
  taskDone: boolean
}

/**
 * A labeller's answer for one taxonomy of their task. Answers are final: a
 * second save for the same taxonomy is refused (a reviewer decides instead).
 */
export async function saveTaskAnswer(opts: {
  user: CurrentUser
  round: ActiveRound
  task: Task
  taxonomyId: string
  labels: LabelInput[]
  labelingStartedAt: Date | null
  operationId: string
}): Promise<TaskSaveResult> {
  const { user, round, task, taxonomyId, labels, labelingStartedAt, operationId } = opts
  const tx = db()
  const outcome = round.outcomes.find(o => o.taxonomyId === taxonomyId)
  if (!outcome) {
    throw new DoubleAnnotationError('This taxonomy is not part of the double annotation of this record', 400)
  }

  const existing = await taskLabels([task.id], taxonomyId)
  if (existing.length > 0) {
    if (sameLabels(existing, labels)) return taskResult(round, task) // replay of the same answer
    throw new DoubleAnnotationError(
      'You already submitted this taxonomy. Answers are final; a supervisor can resolve differences.',
      409
    )
  }

  await tx.doubleTaskLabel.createMany({
    data: labels.map(l => ({
      workspaceId: scopeWorkspaceId(),
      taskId: task.id,
      taxonomyId,
      level: l.level,
      nodeCode: l.nodeCode,
      labelingStartedAt
    }))
  })

  const other = round.tasks.find(t => t.id !== task.id)
  const otherLabels = other ? await taskLabels([other.id], taxonomyId) : []
  const now = new Date()
  if (otherLabels.length > 0 && outcome.state === 'waiting') {
    // Second answer: compare once and freeze the result of the comparison.
    const { state, matched } = compareAnswers(otherLabels, labels)
    await tx.doubleOutcome.update({
      where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
      data: { state, matched, comparedAt: now, sourceTaskId: outcome.sourceTaskId ?? other!.id }
    })
    if (state === 'agreed') await countForLearning(taxonomyId, labels.length)
  } else if (!outcome.sourceTaskId) {
    // First answer: it is the record's result until the comparison says otherwise.
    await tx.doubleOutcome.update({
      where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
      data: { sourceTaskId: task.id }
    })
    await writeResult(round.sentenceId, taxonomyId, labels, user.id, labelingStartedAt)
  }

  await recordLabelingActivity(tx, {
    workspaceId: scopeWorkspaceId(),
    sentenceIds: [round.sentenceId],
    taxonomyId,
    actorId: user.id,
    operationId
  })

  return taskResult(round, task, now)
}

/** Marks the task submitted once it answered every required taxonomy. */
async function taskResult(round: ActiveRound, task: Task, now = new Date()): Promise<TaskSaveResult> {
  const answered = new Set((await taskLabels([task.id])).map(l => l.taxonomyId))
  const taskDone = round.outcomes.every(o => answered.has(o.taxonomyId))
  if (taskDone && task.status !== 'submitted') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'submitted', submittedAt: now } })
  } else if (!taskDone && task.status === 'skipped') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'pending' } })
  }
  const { status } = await settleRound(round.id)
  return { recordStatus: status, answeredTaxonomyIds: answered, taskDone }
}

/** A labeller skips their part; the other part and the record's labels are unaffected. */
export async function skipTask(task: Task) {
  if (task.status === 'pending') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'skipped' } })
  }
}

/**
 * A reviewer's decision for one taxonomy: the chosen path (one of the two
 * answers or another valid path) becomes the confirmed result. Allowed once
 * both answers exist (or to correct an earlier decision); the original
 * comparison is kept.
 */
export async function reviewTaxonomy(opts: {
  user: CurrentUser
  round: ActiveRound
  taxonomyId: string
  labels: LabelInput[]
  note?: string | null
  labelingStartedAt: Date | null
  operationId: string
}): Promise<{ recordStatus: 'submitted' | 'pending' }> {
  const { user, round, taxonomyId, labels, note, labelingStartedAt, operationId } = opts
  const tx = db()
  if (!(await canReview(user, round))) {
    throw new DoubleAnnotationError(
      'You cannot review this record: you labelled it, or one of its labellers is outside your team',
      403
    )
  }
  const outcome = round.outcomes.find(o => o.taxonomyId === taxonomyId)
  if (!outcome) {
    throw new DoubleAnnotationError('This taxonomy is not part of the double annotation of this record', 400)
  }
  if (outcome.state === 'waiting') {
    throw new DoubleAnnotationError(
      'This taxonomy is still waiting for labels. Accept the single label instead, or wait for the second one.',
      409
    )
  }
  if (outcome.state === 'accepted_single') {
    throw new DoubleAnnotationError('The single label was already accepted for this record', 409)
  }

  const current = await tx.sentenceAnnotation.findMany({
    where: { sentenceId: round.sentenceId, taxonomyId, source: 'user' },
    select: { level: true, nodeCode: true }
  })
  const wasConfirmed = isConfirmed(outcome.state as OutcomeState)
  await tx.doubleOutcome.update({
    where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
    data: { state: 'reviewed', reviewedById: user.id, reviewedAt: new Date(), note: note?.trim() || null }
  })
  if (!sameLabels(current, labels)) {
    await writeResult(round.sentenceId, taxonomyId, labels, user.id, labelingStartedAt)
  }
  if (!wasConfirmed || !sameLabels(current, labels)) await countForLearning(taxonomyId, labels.length)
  await recordLabelingActivity(tx, {
    workspaceId: scopeWorkspaceId(),
    sentenceIds: [round.sentenceId],
    taxonomyId,
    actorId: user.id,
    operationId,
    kind: 'review'
  })
  const { status } = await settleRound(round.id)
  return { recordStatus: status }
}

/** Manager checks shared by the round commands: role, own participation, team. */
async function requireManager(user: CurrentUser, round: ActiveRound) {
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    throw new DoubleAnnotationError('Only supervisors and admins can manage double annotation', 403)
  }
  if (!(await canReview(user, round))) {
    throw new DoubleAnnotationError(
      'You cannot manage this record: you labelled it, or one of its labellers is outside your team',
      403
    )
  }
}

/**
 * Waives the missing second label: every taxonomy that has one answer keeps
 * it as the confirmed result. Refused while a taxonomy disagrees (review it)
 * or has no answer at all.
 */
export async function acceptSingle(user: CurrentUser, round: ActiveRound, reason: string) {
  await requireManager(user, round)
  if (round.outcomes.some(o => o.state === 'disagreed')) {
    throw new DoubleAnnotationError('The two labels disagree: review them instead of accepting one', 409)
  }
  if (round.outcomes.some(o => o.state === 'waiting' && !o.sourceTaskId)) {
    throw new DoubleAnnotationError('Every taxonomy needs at least one label before it can be accepted', 409)
  }
  const tx = db()
  const now = new Date()
  for (const outcome of round.outcomes.filter(o => o.state === 'waiting')) {
    await tx.doubleOutcome.update({
      where: { roundId_taxonomyId: { roundId: round.id, taxonomyId: outcome.taxonomyId } },
      data: { state: 'accepted_single', reviewedById: user.id, reviewedAt: now }
    })
    const rows = await tx.sentenceAnnotation.count({
      where: { sentenceId: round.sentenceId, taxonomyId: outcome.taxonomyId, source: 'user' }
    })
    await countForLearning(outcome.taxonomyId, rows)
  }
  await tx.doubleTask.updateMany({
    where: { roundId: round.id, status: { in: ['pending', 'skipped'] } },
    data: { status: 'cancelled' }
  })
  await tx.doubleRound.update({
    where: { id: round.id },
    data: { status: 'completed', closedAt: now, closedById: user.id, closeReason: reason }
  })
  return { recordStatus: 'submitted' as const }
}

/**
 * Stops double annotation: open parts are cancelled, given answers and
 * comparisons stay for the record, and the record is ordinary work again
 * (its current labels decide its status the usual way).
 */
export async function stopRound(user: CurrentUser, round: ActiveRound, reason: string) {
  await requireManager(user, round)
  const tx = db()
  await tx.doubleTask.updateMany({
    where: { roundId: round.id, status: { in: ['pending', 'skipped'] } },
    data: { status: 'cancelled' }
  })
  await tx.doubleRound.update({
    where: { id: round.id },
    data: { status: 'cancelled', closedAt: new Date(), closedById: user.id, closeReason: reason }
  })
}

/** Hands an unstarted part (pending or skipped, no answers yet) to someone else. */
export async function reassignTask(user: CurrentUser, round: ActiveRound, position: number, userId: string) {
  await requireManager(user, round)
  const task = round.tasks.find(t => t.position === position)
  if (!task) throw new DoubleAnnotationError('No such part', 404)
  if (task.status === 'submitted') throw new DoubleAnnotationError('This part is already done', 409)
  if ((await taskLabels([task.id])).length > 0) {
    throw new DoubleAnnotationError(
      'This person already labelled part of the record. Accept the single label or stop double annotation instead.',
      409
    )
  }
  if (round.tasks.some(t => t.id !== task.id && t.assigneeId === userId)) {
    throw new DoubleAnnotationError('The two labels must come from two different people', 400)
  }
  await requireAssignable(user, [userId])
  await db().doubleTask.update({ where: { id: task.id }, data: { assigneeId: userId, status: 'pending' } })
  await ensureAccess([round.sentenceId], [userId], user.id)
}

/** Active members the caller may assign work to (their team for supervisors); returns user id -> membership id. */
export async function requireAssignable(user: CurrentUser, userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds))
  const members = await visibleMembers(user)
  if (members !== null) {
    const team = new Set(members.map(m => m.userId))
    if (ids.some(id => !team.has(id))) {
      throw new DoubleAnnotationError('You can only assign people in your team', 403)
    }
  }
  const rows = await db().workspaceMembership.findMany({
    where: { workspaceId: user.workspaceId, userId: { in: ids }, status: 'active' },
    select: { id: true, userId: true }
  })
  if (rows.length !== ids.length) throw new DoubleAnnotationError('Unknown or suspended member', 400)
  return new Map(rows.map(r => [r.userId, r.id]))
}

/** Record access (SentenceAssignment) for the people who label in a round. */
async function ensureAccess(sentenceIds: string[], userIds: string[], assignedBy: string) {
  const memberships = await db().workspaceMembership.findMany({
    where: { userId: { in: userIds }, status: 'active' },
    select: { id: true }
  })
  await db().sentenceAssignment.createMany({
    data: sentenceIds.flatMap(sentenceId =>
      memberships.map(m => ({ workspaceId: scopeWorkspaceId(), sentenceId, membershipId: m.id, assignedBy }))
    ),
    skipDuplicates: true
  })
}

// ---------------------------------------------------------------------------
// Starting double annotation for a selection of records.

export type StartCategory = 'fresh' | 'labelled' | 'already' | 'needs_first'

export type StartPlanItem = {
  sentenceId: string
  category: StartCategory
  /** labelled: whose existing labels count as the first answer. */
  baselineAuthorId?: string
  /** Who labels: fresh -> [first, second]; labelled -> [the other person]. */
  labellerIds: string[]
}

export type StartPlan = {
  items: StartPlanItem[]
  counts: Record<StartCategory, number>
}

/**
 * Decides, per record, what starting double annotation means:
 * - fresh: not completely labelled by one known person. Both people label it;
 *   any existing labels stay the result until the first new answer arrives.
 * - labelled: completely labelled by one known person. Those labels are the
 *   first answer; the second person (or the first, if the second person wrote
 *   them) adds the other.
 * - already: in double annotation already; left unchanged.
 * - needs_first: unlabelled, but only one person was chosen.
 */
export async function planStart(
  sentenceIds: string[],
  firstUserId: string | null,
  secondUserId: string
): Promise<StartPlan> {
  const tx = db()
  const activeTaxonomyIds = (await tx.taxonomy.findMany({ where: { isActive: true }, select: { id: true } })).map(
    t => t.id
  )
  if (activeTaxonomyIds.length === 0) throw new DoubleAnnotationError('No active taxonomy', 400)

  const [rounds, labels] = await Promise.all([
    tx.doubleRound.findMany({
      where: { sentenceId: { in: sentenceIds }, status: 'active' },
      select: { sentenceId: true }
    }),
    tx.sentenceAnnotation.findMany({
      where: { sentenceId: { in: sentenceIds }, taxonomyId: { in: activeTaxonomyIds }, source: 'user' },
      select: { sentenceId: true, taxonomyId: true, createdById: true }
    })
  ])
  const inRound = new Set(rounds.map(r => r.sentenceId))
  const bySentence = new Map<string, Array<{ taxonomyId: string; createdById: string | null }>>()
  labels.forEach(l => {
    if (!bySentence.has(l.sentenceId)) bySentence.set(l.sentenceId, [])
    bySentence.get(l.sentenceId)!.push(l)
  })

  const counts: Record<StartCategory, number> = { fresh: 0, labelled: 0, already: 0, needs_first: 0 }
  const items = Array.from(new Set(sentenceIds)).map((sentenceId): StartPlanItem => {
    let item: StartPlanItem
    const rows = bySentence.get(sentenceId) ?? []
    const authors = new Set(rows.map(r => r.createdById))
    const complete = activeTaxonomyIds.every(id => rows.some(r => r.taxonomyId === id))
    const author = authors.size === 1 ? [...authors][0] : null
    if (inRound.has(sentenceId)) {
      item = { sentenceId, category: 'already', labellerIds: [] }
    } else if (complete && author) {
      const other = author === secondUserId ? firstUserId : secondUserId
      item = other
        ? { sentenceId, category: 'labelled', baselineAuthorId: author, labellerIds: [other] }
        : { sentenceId, category: 'needs_first', labellerIds: [] }
    } else if (firstUserId) {
      item = { sentenceId, category: 'fresh', labellerIds: [firstUserId, secondUserId] }
    } else {
      item = { sentenceId, category: 'needs_first', labellerIds: [] }
    }
    counts[item.category]++
    return item
  })
  return { items, counts }
}

/** Creates the rounds of a plan (records in 'fresh' and 'labelled' only). Caller holds the record locks. */
export async function startRounds(user: CurrentUser, plan: StartPlan): Promise<number> {
  const tx = db()
  const workspaceId = scopeWorkspaceId()
  const taxonomyIds = (await tx.taxonomy.findMany({ where: { isActive: true }, select: { id: true } })).map(t => t.id)
  const startable = plan.items.filter(i => i.category === 'fresh' || i.category === 'labelled')
  const baselineLabels = await tx.sentenceAnnotation.findMany({
    where: {
      sentenceId: { in: startable.filter(i => i.category === 'labelled').map(i => i.sentenceId) },
      taxonomyId: { in: taxonomyIds },
      source: 'user'
    },
    select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true, labelingStartedAt: true }
  })

  for (const item of startable) {
    const round = await tx.doubleRound.create({
      data: { workspaceId, sentenceId: item.sentenceId, createdById: user.id },
      select: { id: true }
    })
    let baselineTaskId: string | null = null
    if (item.category === 'labelled') {
      const baseline = await tx.doubleTask.create({
        data: {
          workspaceId,
          roundId: round.id,
          sentenceId: item.sentenceId,
          position: 1,
          assigneeId: item.baselineAuthorId!,
          status: 'submitted',
          fromBaseline: true,
          submittedAt: new Date()
        },
        select: { id: true }
      })
      baselineTaskId = baseline.id
      await tx.doubleTaskLabel.createMany({
        data: baselineLabels
          .filter(l => l.sentenceId === item.sentenceId)
          .map(l => ({
            workspaceId,
            taskId: baseline.id,
            taxonomyId: l.taxonomyId,
            level: l.level,
            nodeCode: l.nodeCode,
            labelingStartedAt: l.labelingStartedAt
          }))
      })
    }
    const firstPosition = baselineTaskId ? 2 : 1
    await tx.doubleTask.createMany({
      data: item.labellerIds.map((assigneeId, i) => ({
        workspaceId,
        roundId: round.id,
        sentenceId: item.sentenceId,
        position: firstPosition + i,
        assigneeId
      }))
    })
    await tx.doubleOutcome.createMany({
      data: taxonomyIds.map(taxonomyId => ({
        workspaceId,
        roundId: round.id,
        sentenceId: item.sentenceId,
        taxonomyId,
        sourceTaskId: baselineTaskId
      }))
    })
  }

  // The labels stay; confirmation now waits for the second answer.
  await tx.sentence.updateMany({
    where: { id: { in: startable.map(i => i.sentenceId) } },
    data: { status: 'pending' }
  })
  const byPerson = new Map<string, string[]>()
  startable.forEach(i =>
    i.labellerIds.forEach(id => {
      if (!byPerson.has(id)) byPerson.set(id, [])
      byPerson.get(id)!.push(i.sentenceId)
    })
  )
  for (const [userId, ids] of byPerson) await ensureAccess(ids, [userId], user.id)
  return startable.length
}

// ---------------------------------------------------------------------------
// Blind reads: what the labellers of a round must not see.

/**
 * The records among `sentenceIds` that `user` sees blind: in an active round
 * where they label (or, as a labeller, where they do not label but have
 * access). Blind views show only the person's own answer and comments, no AI
 * suggestions, and no other labels.
 */
export async function blindSentenceIds(user: CurrentUser, sentenceIds: string[]): Promise<Set<string>> {
  if (sentenceIds.length === 0) return new Set()
  const rounds = await db().doubleRound.findMany({
    where: { sentenceId: { in: sentenceIds }, status: 'active' },
    select: { sentenceId: true, tasks: { where: { status: { not: 'cancelled' } }, select: { assigneeId: true } } }
  })
  const manager = user.role === 'admin' || user.role === 'supervisor'
  return new Set(rounds.filter(r => !manager || r.tasks.some(t => t.assigneeId === user.id)).map(r => r.sentenceId))
}

/** Comment filter for one record: only the caller's own comments when they see it blind. */
export async function commentAudienceFilter(user: CurrentUser, sentenceId: string): Promise<Prisma.CommentWhereInput> {
  return (await blindSentenceIds(user, [sentenceId])).has(sentenceId) ? { authorId: user.id } : {}
}

/**
 * Prisma filter excluding records the caller labels blind, for queue filters
 * on labels (a label filter would otherwise reveal the other answer).
 */
export function notBlindFor(user: CurrentUser): Prisma.SentenceWhereInput {
  const own = {
    status: 'active' as const,
    tasks: { some: { assigneeId: user.id, status: { not: 'cancelled' as const } } }
  }
  if (user.role === 'admin' || user.role === 'supervisor') return { NOT: { doubleRounds: { some: own } } }
  return { NOT: { doubleRounds: { some: { status: 'active' } } } }
}

/** Own answers of `user` in the active rounds of `sentenceIds`, by record. */
export async function ownAnswers(user: CurrentUser, sentenceIds: string[]) {
  const tasks = await db().doubleTask.findMany({
    where: {
      sentenceId: { in: sentenceIds },
      assigneeId: user.id,
      status: { not: 'cancelled' },
      round: { status: 'active' }
    },
    select: {
      id: true,
      sentenceId: true,
      status: true,
      labels: {
        select: { taxonomyId: true, level: true, nodeCode: true, labelingStartedAt: true, createdAt: true },
        orderBy: { level: 'asc' }
      }
    }
  })
  return new Map(tasks.map(t => [t.sentenceId, t]))
}

// ---------------------------------------------------------------------------
// The record screen's view of a round.

type PathView = Array<{ level: number; nodeCode: string; nodeLabel: string | null }>

export type DoubleRecordView =
  | {
      mode: 'task'
      taskStatus: 'pending' | 'submitted' | 'skipped'
      /** Taxonomy keys the round requires and those this person answered. */
      required: string[]
      answered: string[]
    }
  | { mode: 'hidden' }
  | {
      mode: 'manager'
      roundId: string
      canReview: boolean
      tasks: Array<{
        position: number
        status: string
        fromBaseline: boolean
        assignee: { id: string; name: string } | null
      }>
      outcomes: Array<{
        taxonomyKey: string
        state: OutcomeState
        matched: boolean | null
        sourcePosition: number | null
        reviewedBy: string | null
        note: string | null
        answers: Array<{ position: number; labels: PathView }>
      }>
    }

async function nodeLabels(rows: Array<{ taxonomyId: string; nodeCode: string }>) {
  if (rows.length === 0) return new Map<string, string>()
  const nodes = await db().taxonomyNode.findMany({
    where: {
      taxonomyId: { in: Array.from(new Set(rows.map(r => r.taxonomyId))) },
      code: { in: Array.from(new Set(rows.map(r => r.nodeCode))) }
    },
    select: { taxonomyId: true, code: true, label: true }
  })
  return new Map(nodes.map(n => [`${n.taxonomyId}:${n.code}`, n.label]))
}

export async function recordView(user: CurrentUser, view: DoubleView): Promise<DoubleRecordView> {
  const { round } = view
  const taxonomies = await db().taxonomy.findMany({
    where: { id: { in: round.outcomes.map(o => o.taxonomyId) } },
    select: { id: true, key: true },
    orderBy: { key: 'asc' }
  })
  const keyOf = new Map(taxonomies.map(t => [t.id, t.key]))
  if (view.mode === 'hidden') return { mode: 'hidden' }
  if (view.mode === 'task') {
    const answered = new Set((await taskLabels([view.task.id])).map(l => l.taxonomyId))
    return {
      mode: 'task',
      taskStatus: view.task.status === 'cancelled' ? 'pending' : view.task.status,
      required: taxonomies.map(t => t.key),
      answered: taxonomies.filter(t => answered.has(t.id)).map(t => t.key)
    }
  }

  const [labels, people, reviewers] = await Promise.all([
    taskLabels(round.tasks.map(t => t.id)),
    db().user.findMany({
      where: { id: { in: round.tasks.map(t => t.assigneeId).filter((id): id is string => id !== null) } },
      select: { id: true, name: true }
    }),
    db().user.findMany({
      where: { id: { in: round.outcomes.map(o => o.reviewedById).filter((id): id is string => id !== null) } },
      select: { id: true, name: true }
    })
  ])
  const names = new Map([...people, ...reviewers].map(p => [p.id, p.name]))
  const labelNames = await nodeLabels(labels)
  const positionOf = new Map(round.tasks.map(t => [t.id, t.position]))
  return {
    mode: 'manager',
    roundId: round.id,
    canReview: await canReview(user, round),
    tasks: round.tasks.map(t => ({
      position: t.position,
      status: t.status,
      fromBaseline: t.fromBaseline,
      assignee: t.assigneeId ? { id: t.assigneeId, name: names.get(t.assigneeId) ?? 'Unknown' } : null
    })),
    outcomes: round.outcomes
      .filter(o => keyOf.has(o.taxonomyId))
      .sort((a, b) => keyOf.get(a.taxonomyId)!.localeCompare(keyOf.get(b.taxonomyId)!))
      .map(o => ({
        taxonomyKey: keyOf.get(o.taxonomyId)!,
        state: o.state as OutcomeState,
        matched: o.matched,
        sourcePosition: o.sourceTaskId ? (positionOf.get(o.sourceTaskId) ?? null) : null,
        reviewedBy: o.reviewedById ? (names.get(o.reviewedById) ?? 'Unknown') : null,
        note: o.note,
        answers: round.tasks
          .map(t => ({
            position: t.position,
            labels: labels
              .filter(l => l.taskId === t.id && l.taxonomyId === o.taxonomyId)
              .map(l => ({
                level: l.level,
                nodeCode: l.nodeCode,
                nodeLabel: labelNames.get(`${l.taxonomyId}:${l.nodeCode}`) ?? null
              }))
          }))
          .filter(a => a.labels.length > 0)
      }))
  }
}
