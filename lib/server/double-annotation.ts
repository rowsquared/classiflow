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
  type DoubleRecordView,
  type OutcomeState,
  type RoundSummary
} from '@/lib/double-annotation'
import { recordLabelingActivity } from '@/lib/labeling-activity'

/**
 * Double annotation workflow (prisma/schema.prisma DoubleRound and friends,
 * rules in lib/double-annotation.ts, plan in docs/plans/double-annotation-v2.md).
 * Every function runs inside the workspace transaction (db()); writers lock
 * the record first (lockSentences in lib/annotation-status.ts), so saves,
 * reviews and manager actions on one record run one after the other.
 *
 * SentenceAnnotation stays the record's current result (what the queue,
 * export and learning read): the first answer while waiting or disagreeing,
 * the agreed or reviewed path when confirmed. Sentence.status is `submitted`
 * only once every required taxonomy is confirmed.
 *
 * Participation is sticky: whoever holds a live part (task) in any round of a
 * record sees that record as their own work for good (own answer, comments,
 * flag and edit time; no AI suggestions, nothing of anyone else), also after
 * the round completed or was stopped. Their saves always change their own
 * answer (a new revision), never the result.
 */

export class DoubleAnnotationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message)
  }
}

const LIVE = { not: 'cancelled' as const }

/**
 * A part that makes its person a participant of the record: not cancelled
 * and not given back as ordinary work (releaseParts()).
 */
export const PARTICIPATING = { status: LIVE, releasedAt: null } satisfies Prisma.DoubleTaskWhereInput

const roundInclude = {
  tasks: { where: { status: LIVE }, orderBy: { position: 'asc' } },
  outcomes: true
} satisfies Prisma.DoubleRoundInclude

export type Round = Prisma.DoubleRoundGetPayload<{ include: typeof roundInclude }>
/** @deprecated name kept for callers: any round with its live tasks and outcomes. */
export type ActiveRound = Round
type Task = Round['tasks'][number]

export async function activeRound(sentenceId: string): Promise<Round | null> {
  return db().doubleRound.findFirst({ where: { sentenceId, status: 'active' }, include: roundInclude })
}

/** The record's latest round of any status (managers' view and history). */
export async function newestRound(sentenceId: string): Promise<Round | null> {
  return db().doubleRound.findFirst({
    where: { sentenceId },
    orderBy: { createdAt: 'desc' },
    include: roundInclude
  })
}

/** The record's latest round that was not stopped (active or completed). */
export async function latestRound(sentenceId: string): Promise<Round | null> {
  return db().doubleRound.findFirst({
    where: { sentenceId, status: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
    include: roundInclude
  })
}

// ---------------------------------------------------------------------------
// Participation.

/** Records where `user` holds a live part in any round. */
export function participantWhere(user: CurrentUser): Prisma.SentenceWhereInput {
  return { doubleTasks: { some: { assigneeId: user.id, ...PARTICIPATING } } }
}

/** Records where `user` holds a live part whose current answer matches `labels`. */
export function ownLabelsWhere(user: CurrentUser, labels: Prisma.DoubleTaskLabelWhereInput | null) {
  return {
    doubleTasks: {
      some: {
        assigneeId: user.id,
        ...PARTICIPATING,
        labels: labels === null ? { none: { supersededAt: null } } : { some: { supersededAt: null, ...labels } }
      }
    }
  } satisfies Prisma.SentenceWhereInput
}

export type Participation = {
  task: Pick<Task, 'id' | 'status' | 'flagged' | 'roundId'>
  roundStatus: string
  /** Taxonomy ids the round requires. */
  required: string[]
  /** Current answer (latest revision) per taxonomy. */
  labels: Array<{
    taxonomyId: string
    level: number
    nodeCode: string
    labelingStartedAt: Date | null
    createdAt: Date
  }>
  assignee: { id: string; name: string | null; username: string | null; email: string } | null
}

/** The caller's part per record (the latest round where they hold one), for `sentenceIds`. */
export async function participation(user: CurrentUser, sentenceIds: string[]): Promise<Map<string, Participation>> {
  const result = new Map<string, Participation>()
  if (sentenceIds.length === 0) return result
  const tasks = await db().doubleTask.findMany({
    where: { sentenceId: { in: sentenceIds }, assigneeId: user.id, ...PARTICIPATING },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sentenceId: true,
      roundId: true,
      status: true,
      flagged: true,
      round: { select: { status: true, outcomes: { select: { taxonomyId: true } } } },
      assignee: { select: { id: true, name: true, username: true, email: true } },
      labels: {
        where: { supersededAt: null },
        select: { taxonomyId: true, level: true, nodeCode: true, labelingStartedAt: true, createdAt: true },
        orderBy: { level: 'asc' }
      }
    }
  })
  for (const t of tasks) {
    if (result.has(t.sentenceId)) continue // an older round
    result.set(t.sentenceId, {
      task: { id: t.id, status: t.status, flagged: t.flagged, roundId: t.roundId },
      roundStatus: t.round.status,
      required: t.round.outcomes.map(o => o.taxonomyId),
      labels: t.labels,
      assignee: t.assignee
    })
  }
  return result
}

/** Comment filter for one record: only the caller's own comments when they participate. */
export async function commentAudienceFilter(user: CurrentUser, sentenceId: string): Promise<Prisma.CommentWhereInput> {
  return (await participation(user, [sentenceId])).has(sentenceId) ? { authorId: user.id } : {}
}

/** The caller's live part in the record's latest round where they hold one, with that round. */
export async function participantRound(
  user: CurrentUser,
  sentenceId: string
): Promise<{ round: Round; task: Task } | null> {
  const task = await db().doubleTask.findFirst({
    where: { sentenceId, assigneeId: user.id, ...PARTICIPATING },
    orderBy: { createdAt: 'desc' },
    select: { roundId: true }
  })
  if (!task) return null
  const round = await db().doubleRound.findUniqueOrThrow({ where: { id: task.roundId }, include: roundInclude })
  return { round, task: round.tasks.find(t => t.assigneeId === user.id)! }
}

/**
 * How a non-participant meets a record in an active round:
 * - manager: admin or supervisor;
 * - hidden: a labeller with access but no part (not normally reachable:
 *   such access is removed and sentenceVisibilityFilter() keeps the record out of view).
 */
export type DoubleView = { mode: 'manager'; round: Round } | { mode: 'hidden'; round: Round }

export function viewFor(user: CurrentUser, round: Round): DoubleView {
  if (user.role === 'admin' || user.role === 'supervisor') return { mode: 'manager', round }
  return { mode: 'hidden', round }
}

/**
 * A participant's flag lives on their part; the record's flag goes up for
 * managers when a participant flags it and down when no part is flagged.
 * Returns the records handled this way (the caller sets the record flag of
 * the others as usual).
 */
export async function setParticipantFlags(
  user: CurrentUser,
  sentenceIds: string[],
  flagged: boolean
): Promise<Set<string>> {
  const parts = await participation(user, sentenceIds)
  if (parts.size === 0) return new Set()
  const tx = db()
  await tx.doubleTask.updateMany({
    where: { id: { in: [...parts.values()].map(p => p.task.id) } },
    data: { flagged }
  })
  const ids = [...parts.keys()]
  if (flagged) {
    await tx.sentence.updateMany({ where: { id: { in: ids } }, data: { flagged: true } })
  } else {
    const stillFlagged = new Set(
      (
        await tx.doubleTask.findMany({
          where: { sentenceId: { in: ids }, ...PARTICIPATING, flagged: true },
          select: { sentenceId: true }
        })
      ).map(t => t.sentenceId)
    )
    const clear = ids.filter(id => !stillFlagged.has(id))
    if (clear.length > 0) await tx.sentence.updateMany({ where: { id: { in: clear } }, data: { flagged: false } })
  }
  return new Set(ids)
}

// ---------------------------------------------------------------------------
// Answers and results.

/**
 * A manager may decide a disagreement unless they labelled the record
 * themselves. Supervisors must manage every labeller of the round (their
 * subtree); a labeller without a known account needs an admin.
 */
export async function canReview(user: CurrentUser, round: Round): Promise<boolean> {
  if (user.role !== 'admin' && user.role !== 'supervisor') return false
  if (round.tasks.some(t => t.assigneeId === user.id)) return false
  const members = await visibleMembers(user)
  if (members === null) return true
  const team = new Set(members.map(m => m.userId))
  return round.tasks.every(t => t.assigneeId !== null && team.has(t.assigneeId))
}

/** Current answers (latest revision) of the tasks. */
async function taskLabels(taskIds: string[], taxonomyId?: string) {
  if (taskIds.length === 0) return []
  return db().doubleTaskLabel.findMany({
    where: { taskId: { in: taskIds }, supersededAt: null, ...(taxonomyId ? { taxonomyId } : {}) },
    select: { taskId: true, taxonomyId: true, level: true, nodeCode: true, revision: true },
    orderBy: { level: 'asc' }
  })
}

const codesOf = (labels: LabelInput[]) =>
  labels
    .slice()
    .sort((a, b) => a.level - b.level)
    .map(l => l.nodeCode)

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
  /** The record's status after the save (unchanged when the round is closed). */
  recordStatus: 'submitted' | 'pending' | null
  /** The caller's own task: taxonomies they answered and whether every one is done. */
  answeredTaxonomyIds: Set<string>
  taskDone: boolean
}

/**
 * A participant's answer for one taxonomy, in a round of any status. A
 * changed answer is a new revision (the previous one is kept, superseded):
 * - before the other answer exists it simply replaces the answer (and the
 *   provisional result, when it is the first answer);
 * - after the comparison, the frozen comparison stays; an agreed taxonomy
 *   whose answer now differs needs review again; managers see the revision;
 * - in a closed round only the person's own answer changes, never the result.
 */
export async function saveTaskAnswer(opts: {
  user: CurrentUser
  round: Round
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
    throw new DoubleAnnotationError('This taxonomy is not available for labelling on this record', 400)
  }

  const existing = await taskLabels([task.id], taxonomyId)
  if (existing.length > 0 && sameLabels(existing, labels)) return taskResult(round, task) // nothing changed
  const now = new Date()
  const revision = existing.length > 0 ? existing[0]!.revision + 1 : 1
  if (existing.length > 0) {
    await tx.doubleTaskLabel.updateMany({
      where: { taskId: task.id, taxonomyId, supersededAt: null },
      data: { supersededAt: now }
    })
  }
  await tx.doubleTaskLabel.createMany({
    data: labels.map(l => ({
      workspaceId: scopeWorkspaceId(),
      taskId: task.id,
      taxonomyId,
      level: l.level,
      nodeCode: l.nodeCode,
      revision,
      labelingStartedAt,
      // The same instant as the comparison it may trigger (exports read answers as compared).
      createdAt: now
    }))
  })

  const where = { roundId_taxonomyId: { roundId: round.id, taxonomyId } }
  if (round.status === 'active') {
    const other = round.tasks.find(t => t.id !== task.id)
    const otherLabels = other ? await taskLabels([other.id], taxonomyId) : []
    if (outcome.state === 'waiting' && otherLabels.length > 0) {
      // Second answer: compare once and freeze the result of the comparison.
      const { state, matched } = compareAnswers(otherLabels, labels)
      await tx.doubleOutcome.update({
        where,
        data: {
          state,
          matched,
          comparedAt: now,
          sourceTaskId: outcome.sourceTaskId ?? other!.id,
          resultCodes: state === 'agreed' ? codesOf(labels) : []
        }
      })
      if (state === 'agreed') await countForLearning(taxonomyId, labels.length)
    } else if (outcome.state === 'waiting') {
      // The first answer (or a change of it): the record's provisional result.
      if (!outcome.sourceTaskId || outcome.sourceTaskId === task.id) {
        if (!outcome.sourceTaskId) await tx.doubleOutcome.update({ where, data: { sourceTaskId: task.id } })
        await writeResult(round.sentenceId, taxonomyId, labels, user.id, labelingStartedAt)
      }
    } else {
      // Changed after the comparison: the comparison stays as it was.
      const reopen = outcome.state === 'agreed' && !sameLabels(otherLabels, labels)
      await tx.doubleOutcome.update({
        where,
        data: { revisedAfterCompare: true, ...(reopen ? { state: 'disagreed', resultCodes: [] } : {}) }
      })
    }
  } else if (outcome.comparedAt || isConfirmed(outcome.state as OutcomeState)) {
    await tx.doubleOutcome.update({ where, data: { revisedAfterCompare: true } })
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
async function taskResult(round: Round, task: Task, now = new Date()): Promise<TaskSaveResult> {
  const answered = new Set((await taskLabels([task.id])).map(l => l.taxonomyId))
  const taskDone = round.outcomes.every(o => answered.has(o.taxonomyId))
  if (taskDone && task.status !== 'submitted') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'submitted', submittedAt: now } })
  } else if (!taskDone && task.status === 'skipped') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'pending' } })
  }
  if (round.status !== 'active') return { recordStatus: null, answeredTaxonomyIds: answered, taskDone }
  const { status } = await settleRound(round.id)
  return { recordStatus: status, answeredTaxonomyIds: answered, taskDone }
}

/** A participant skips their part; the other part and the record's labels are unaffected. */
export async function skipTask(task: Task) {
  if (task.status === 'pending') {
    await db().doubleTask.update({ where: { id: task.id }, data: { status: 'skipped' } })
  }
}

/** The taxonomies the participant answered (current answers). */
export async function answeredTaxonomies(taskId: string): Promise<Set<string>> {
  return new Set((await taskLabels([taskId])).map(l => l.taxonomyId))
}

/**
 * A reviewer's decision for one taxonomy: the chosen path (one of the two
 * answers or another valid path) becomes the confirmed result. Allowed once
 * both answers exist (or to correct an earlier decision); the original
 * comparison is kept.
 */
export async function reviewTaxonomy(opts: {
  user: CurrentUser
  round: Round
  taxonomyId: string
  labels: LabelInput[]
  note?: string | null
  /** Required to change a confirmed (agreed or reviewed) taxonomy, with a note. */
  override?: boolean
  labelingStartedAt: Date | null
  operationId: string
}): Promise<{ recordStatus: 'submitted' | 'pending' }> {
  const { user, round, taxonomyId, labels, note, override, labelingStartedAt, operationId } = opts
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

  const wasConfirmed = isConfirmed(outcome.state as OutcomeState)
  requireOverride(wasConfirmed, override, note)

  const current = await tx.sentenceAnnotation.findMany({
    where: { sentenceId: round.sentenceId, taxonomyId, source: 'user' },
    select: { level: true, nodeCode: true }
  })
  await tx.doubleOutcome.update({
    where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
    data: {
      state: 'reviewed',
      reviewedById: user.id,
      reviewedAt: new Date(),
      note: note?.trim() || null,
      resultCodes: codesOf(labels)
    }
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

/** Changing a confirmed result is deliberate: `override` with a reason. */
function requireOverride(confirmed: boolean, override: boolean | undefined, note: string | null | undefined) {
  if (!confirmed) return
  if (!override) {
    throw new DoubleAnnotationError('This label is confirmed. Use "Change confirmed result" to replace it.', 409)
  }
  if (!note?.trim()) throw new DoubleAnnotationError('Give a reason for changing a confirmed result', 400)
}

const pathOf = (codes: string[]) => codes.map((nodeCode, i) => ({ level: i + 1, nodeCode }))

/**
 * Before an ordinary save by a supervisor or admin on a record whose latest
 * round is completed: changing a confirmed taxonomy needs `override` and a
 * reason, and only a manager who may review the round can do it. Labellers
 * (who never see the round) are not checked; their changes export as
 * ordinary labels (lib/double-annotation.ts taxonomyStatus).
 * Returns the round to record the decision on after the save, if any.
 */
export async function guardConfirmedChange(
  user: CurrentUser,
  sentenceId: string,
  taxonomyId: string,
  labels: LabelInput[],
  override: boolean | undefined,
  note: string | null | undefined
): Promise<Round | null> {
  if (user.role !== 'admin' && user.role !== 'supervisor') return null
  const round = await latestRound(sentenceId)
  if (!round || round.status !== 'completed') return null
  const outcome = round.outcomes.find(o => o.taxonomyId === taxonomyId)
  if (!outcome) return null
  if (outcome.resultCodes.length > 0 && sameLabels(labels, pathOf(outcome.resultCodes))) return null
  if (!(await canReview(user, round))) {
    throw new DoubleAnnotationError(
      'You cannot change this result: you labelled it, or one of its labellers is outside your team',
      403
    )
  }
  requireOverride(true, override, note)
  return round
}

/** Records a manager's change of a confirmed result (after guardConfirmedChange) as their decision. */
export async function recordChangedResult(
  user: CurrentUser,
  round: Round,
  taxonomyId: string,
  labels: LabelInput[],
  note: string | null | undefined
) {
  await db().doubleOutcome.update({
    where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
    data: {
      state: 'reviewed',
      reviewedById: user.id,
      reviewedAt: new Date(),
      note: note?.trim() || null,
      resultCodes: codesOf(labels)
    }
  })
}

/**
 * Undoes a review decision (the toast's Undo): the outcome returns to its
 * comparison (agreed or disagreed), the result to the answer it came from,
 * the round is active again when it had completed, and the record is pending
 * until it is confirmed again.
 */
export async function reopenReview(user: CurrentUser, round: Round, taxonomyId: string) {
  await requireManager(user, round)
  const outcome = round.outcomes.find(o => o.taxonomyId === taxonomyId)
  if (!outcome || outcome.state !== 'reviewed' || outcome.matched === null) {
    throw new DoubleAnnotationError('There is no decision to undo for this taxonomy', 409)
  }
  if (round.status === 'cancelled') {
    throw new DoubleAnnotationError('Double annotation was stopped for this record', 409)
  }
  const source = outcome.sourceTaskId ? await taskLabels([outcome.sourceTaskId], taxonomyId) : []
  const state = outcome.matched ? 'agreed' : 'disagreed'
  await db().doubleOutcome.update({
    where: { roundId_taxonomyId: { roundId: round.id, taxonomyId } },
    data: {
      state,
      reviewedById: null,
      reviewedAt: null,
      note: null,
      resultCodes: state === 'agreed' ? codesOf(source) : []
    }
  })
  if (source.length > 0) await writeResult(round.sentenceId, taxonomyId, source, user.id, null)
  if (round.status === 'completed') {
    await db().doubleRound.update({ where: { id: round.id }, data: { status: 'active', closedAt: null } })
  }
  const { status } = await settleRound(round.id)
  await db().sentence.update({ where: { id: round.sentenceId }, data: { status } })
}

/** Manager checks shared by the round commands: role, own participation, team. */
async function requireManager(user: CurrentUser, round: Round) {
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
 * Closes the parts nobody has answered (cancelled, their people lose access
 * to the record). Parts with answers stay: their people keep seeing the
 * record as their own work.
 */
async function cancelUnansweredParts(round: Round) {
  const answered = new Set((await taskLabels(round.tasks.map(t => t.id))).map(l => l.taskId))
  const open = round.tasks.filter(t => t.status !== 'submitted' && !answered.has(t.id))
  if (open.length === 0) return
  await db().doubleTask.updateMany({ where: { id: { in: open.map(t => t.id) } }, data: { status: 'cancelled' } })
  await dropLabellerAccess(
    [round.sentenceId],
    open.flatMap(t => (t.assigneeId ? [t.assigneeId] : []))
  )
}

/**
 * Waives the missing second label: every taxonomy that has one answer keeps
 * it as the confirmed result. Refused while a taxonomy disagrees (review it)
 * or has no answer at all.
 */
export async function acceptSingle(user: CurrentUser, round: Round, reason: string) {
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
    const rows = await tx.sentenceAnnotation.findMany({
      where: { sentenceId: round.sentenceId, taxonomyId: outcome.taxonomyId, source: 'user' },
      select: { level: true, nodeCode: true }
    })
    await tx.doubleOutcome.update({
      where: { roundId_taxonomyId: { roundId: round.id, taxonomyId: outcome.taxonomyId } },
      data: { state: 'accepted_single', reviewedById: user.id, reviewedAt: now, resultCodes: codesOf(rows) }
    })
    await countForLearning(outcome.taxonomyId, rows.length)
  }
  await cancelUnansweredParts(round)
  await tx.doubleRound.update({
    where: { id: round.id },
    data: { status: 'completed', closedAt: now, closedById: user.id, closeReason: reason }
  })
  return { recordStatus: 'submitted' as const }
}

/**
 * Stops double annotation: unanswered parts are cancelled (their people lose
 * access), given answers and comparisons stay, people who answered keep
 * seeing only their own answer, and the record is ordinary work again (its
 * current labels decide its status the usual way).
 */
export async function stopRound(user: CurrentUser, round: Round, reason: string) {
  await requireManager(user, round)
  await cancelUnansweredParts(round)
  await db().doubleRound.update({
    where: { id: round.id },
    data: { status: 'cancelled', closedAt: new Date(), closedById: user.id, closeReason: reason }
  })
}

/**
 * Hands an unstarted part (pending or skipped, no answers yet) to someone
 * else: the old part is cancelled (kept for the history), a new one is
 * created in the same position, and the previous person loses access.
 */
export async function reassignTask(user: CurrentUser, round: Round, position: number, userId: string) {
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
  if (task.assigneeId === userId) return
  await requireAssignable(user, [userId])
  const tx = db()
  await tx.doubleTask.update({ where: { id: task.id }, data: { status: 'cancelled' } })
  await tx.doubleTask.create({
    data: {
      workspaceId: scopeWorkspaceId(),
      roundId: round.id,
      sentenceId: round.sentenceId,
      position,
      assigneeId: userId
    }
  })
  if (task.assigneeId) await dropLabellerAccess([round.sentenceId], [task.assigneeId])
  await ensureAccess([round.sentenceId], [userId], user.id)
}

/**
 * "Give back as ordinary work": ends `personId`'s participation in the record
 * once no round of it is open. Their parts stay in the history, comparisons
 * and exports; from now on they see the record as ordinary work (its current
 * result, every comment) and their saves change it like any other label.
 * The record is assigned to them if it was not.
 */
export async function releaseParts(user: CurrentUser, sentenceId: string, personId: string, dryRun = false) {
  const parts = await db().doubleTask.findMany({
    where: { sentenceId, assigneeId: personId, ...PARTICIPATING },
    select: { id: true, roundId: true }
  })
  if (parts.length === 0) throw new DoubleAnnotationError('The person has no part in it', 409)
  if (await activeRound(sentenceId)) {
    throw new DoubleAnnotationError('Still in an open round: hand the part over or stop double annotation first', 409)
  }
  for (const roundId of new Set(parts.map(p => p.roundId))) {
    await requireManager(
      user,
      await db().doubleRound.findUniqueOrThrow({ where: { id: roundId }, include: roundInclude })
    )
  }
  if (dryRun) return
  await db().doubleTask.updateMany({
    where: { id: { in: parts.map(p => p.id) } },
    data: { releasedAt: new Date(), releasedById: user.id }
  })
  await ensureAccess([sentenceId], [personId], user.id)
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

/**
 * Removes labellers' record access: nobody with the labeller role keeps a
 * record of a round they have no part in (they would see it without labels,
 * or later see someone else's answer). Supervisors and admins keep theirs.
 */
async function dropLabellerAccess(sentenceIds: string[], userIds: string[]) {
  if (sentenceIds.length === 0 || userIds.length === 0) return
  await db().sentenceAssignment.deleteMany({
    where: {
      sentenceId: { in: sentenceIds },
      membership: { userId: { in: userIds }, role: 'labeller' }
    }
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
  /** Startable records with labels by several people or partial labels: both new people label them. */
  mixed: number
  /** New parts per person. */
  people: Array<{ userId: string; name: string; parts: number }>
  /** Labeller assignments the start removes (people without a part in the round). */
  losingAccess: number
}

/** The second person: one chosen person, or automatic among `candidates` (fewest open parts first). */
export type SecondPerson = { userId: string } | { auto: string[] }

/** Active labellers the caller may assign (their team for supervisors), for the automatic second person. */
export async function autoCandidates(user: CurrentUser): Promise<string[]> {
  const members = await visibleMembers(user)
  const rows = await db().workspaceMembership.findMany({
    where: {
      workspaceId: user.workspaceId,
      status: 'active',
      role: 'labeller',
      ...(members === null ? {} : { userId: { in: members.map(m => m.userId) } })
    },
    select: { userId: true },
    orderBy: { userId: 'asc' }
  })
  return rows.map(r => r.userId)
}

/** A random share of the records, the same for the same seed (preview and commit agree). */
export function sampleRecords(sentenceIds: string[], percent: number, seed: number): string[] {
  const ids = Array.from(new Set(sentenceIds)).sort()
  const take = Math.max(1, Math.ceil((ids.length * Math.min(100, Math.max(0, percent))) / 100))
  let state = seed >>> 0 || 1
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  }
  return ids.slice(0, take)
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
  second: SecondPerson
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
  // Automatic second person: the candidate with the fewest open parts (counting this plan).
  const load = new Map<string, number>()
  if ('auto' in second) {
    const open = await tx.doubleTask.groupBy({
      by: ['assigneeId'],
      where: { assigneeId: { in: second.auto }, status: { in: ['pending', 'skipped'] }, round: { status: 'active' } },
      _count: { _all: true }
    })
    second.auto.forEach(id => load.set(id, 0))
    open.forEach(o => o.assigneeId && load.set(o.assigneeId, o._count._all))
  }
  const pick = (exclude: Array<string | null | undefined>): string | null => {
    if ('userId' in second) return exclude.includes(second.userId) ? null : second.userId
    let best: string | null = null
    for (const [id, n] of load) {
      if (exclude.includes(id)) continue
      if (best === null || n < load.get(best)!) best = id
    }
    if (best) load.set(best, load.get(best)! + 1)
    return best
  }
  const secondUserId = 'userId' in second ? second.userId : null
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
      const other = secondUserId !== null && author === secondUserId ? firstUserId : pick([author])
      item = other
        ? { sentenceId, category: 'labelled', baselineAuthorId: author, labellerIds: [other] }
        : { sentenceId, category: 'needs_first', labellerIds: [] }
    } else if (firstUserId) {
      const other = pick([firstUserId])
      item = other
        ? { sentenceId, category: 'fresh', labellerIds: [firstUserId, other] }
        : { sentenceId, category: 'needs_first', labellerIds: [] }
    } else {
      item = { sentenceId, category: 'needs_first', labellerIds: [] }
    }
    counts[item.category]++
    return item
  })

  const startable = items.filter(i => i.category === 'fresh' || i.category === 'labelled')
  const mixed = startable.filter(i => i.category === 'fresh' && (bySentence.get(i.sentenceId)?.length ?? 0) > 0).length
  const parts = new Map<string, number>()
  startable.forEach(i => i.labellerIds.forEach(id => parts.set(id, (parts.get(id) ?? 0) + 1)))
  const names = await tx.user.findMany({ where: { id: { in: [...parts.keys()] } }, select: { id: true, name: true } })
  const assignments = await tx.sentenceAssignment.findMany({
    where: { sentenceId: { in: startable.map(i => i.sentenceId) }, membership: { role: 'labeller' } },
    select: { sentenceId: true, membership: { select: { userId: true } } }
  })
  const keep = new Map(
    startable.map(i => [i.sentenceId, new Set([...i.labellerIds, ...(i.baselineAuthorId ? [i.baselineAuthorId] : [])])])
  )
  const losingAccess = assignments.filter(a => !keep.get(a.sentenceId)?.has(a.membership.userId)).length
  return {
    items,
    counts,
    mixed,
    people: [...parts]
      .map(([userId, n]) => ({ userId, name: names.find(u => u.id === userId)?.name ?? 'Unknown', parts: n }))
      .sort((a, b) => b.parts - a.parts || a.name.localeCompare(b.name)),
    losingAccess
  }
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
    select: {
      sentenceId: true,
      taxonomyId: true,
      level: true,
      nodeCode: true,
      labelingStartedAt: true,
      createdAt: true
    }
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
            labelingStartedAt: l.labelingStartedAt,
            // When the labels were made, not when the round started.
            createdAt: l.createdAt
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
  // Only the round's people keep labeller access to its record.
  for (const item of startable) {
    const keep = new Set([...item.labellerIds, ...(item.baselineAuthorId ? [item.baselineAuthorId] : [])])
    await tx.sentenceAssignment.deleteMany({
      where: {
        sentenceId: item.sentenceId,
        membership: { role: 'labeller', userId: { notIn: [...keep] } }
      }
    })
  }
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
// The record screen's view of an active round, for managers.

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
  if (view.mode === 'hidden') return { mode: 'hidden' }
  const { round } = view
  const taxonomies = await db().taxonomy.findMany({
    where: { id: { in: round.outcomes.map(o => o.taxonomyId) } },
    select: { id: true, key: true },
    orderBy: { key: 'asc' }
  })
  const keyOf = new Map(taxonomies.map(t => [t.id, t.key]))
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
  const former = await db().doubleTask.findMany({
    where: { roundId: round.id, status: 'cancelled' },
    orderBy: { createdAt: 'asc' },
    select: { position: true, assignee: { select: { name: true } } }
  })
  return {
    mode: 'manager',
    roundId: round.id,
    status: round.status,
    closeReason: round.closeReason,
    closedAt: round.closedAt?.toISOString() ?? null,
    canReview: await canReview(user, round),
    former: former.map(f => ({ position: f.position, name: f.assignee?.name ?? 'Former member' })),
    tasks: round.tasks.map(t => ({
      position: t.position,
      status: t.status,
      fromBaseline: t.fromBaseline,
      releasedAt: t.releasedAt?.toISOString() ?? null,
      assignee: t.assigneeId ? { id: t.assigneeId, name: names.get(t.assigneeId) ?? 'Unknown' } : null
    })),
    outcomes: round.outcomes
      .filter(o => keyOf.has(o.taxonomyId))
      .sort((a, b) => keyOf.get(a.taxonomyId)!.localeCompare(keyOf.get(b.taxonomyId)!))
      .map(o => ({
        taxonomyKey: keyOf.get(o.taxonomyId)!,
        state: o.state as OutcomeState,
        matched: o.matched,
        revisedAfterCompare: o.revisedAfterCompare,
        sourcePosition: o.sourceTaskId ? (positionOf.get(o.sourceTaskId) ?? null) : null,
        reviewedBy: o.reviewedById ? (names.get(o.reviewedById) ?? 'Unknown') : null,
        reviewedAt: o.reviewedAt?.toISOString() ?? null,
        comparedAt: o.comparedAt?.toISOString() ?? null,
        note: o.note,
        resultCodes: o.resultCodes,
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
