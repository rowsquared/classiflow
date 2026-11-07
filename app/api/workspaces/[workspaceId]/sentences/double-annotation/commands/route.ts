import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { completedTaxonomies, isComplete, lockSentences } from '@/lib/annotation-status'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/logger'
import { db } from '@/lib/workspace/db'
import {
  DoubleAnnotationError,
  acceptSingle,
  activeRound,
  canReview,
  reassignTask,
  releaseParts,
  requireAssignable,
  stopRound
} from '@/lib/server/double-annotation'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['accept_single', 'stop']),
    sentenceIds: z.array(z.string().min(1)).min(1).max(1000),
    reason: z.string().trim().min(1).max(500),
    dryRun: z.boolean().optional()
  }),
  z.object({
    action: z.literal('hand_over'),
    sentenceIds: z.array(z.string().min(1)).min(1).max(1000),
    fromUserId: z.string().min(1),
    toUserId: z.string().min(1),
    dryRun: z.boolean().optional()
  }),
  z.object({
    action: z.literal('release'),
    sentenceIds: z.array(z.string().min(1)).min(1).max(1000),
    userId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
    dryRun: z.boolean().optional()
  })
])

/**
 * POST /api/workspaces/[workspaceId]/sentences/double-annotation/commands
 *
 * A manager's command on many records' active rounds at once (the queue's
 * "Double annotation…" bulk action): accept_single and stop with a reason,
 * hand_over every unstarted part of one person to another, or release one
 * person's parts ("give back as ordinary work", once no round of the record
 * is open: they then see it as ordinary work). Records the
 * command does not apply to (no active round, a disagreement to review, a
 * part already answered, outside the caller's team, ...) are skipped and
 * counted. `dryRun` returns the counts without changing anything.
 */
export const POST = workspaceRoute(['admin', 'supervisor'], async (req, { user }) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request data' }, { status: 400 })
    const command = parsed.data
    const sentenceIds = Array.from(new Set(command.sentenceIds))
    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied
    if (command.action === 'hand_over') {
      if (command.fromUserId === command.toUserId) {
        return NextResponse.json({ ok: false, error: 'Choose two different people' }, { status: 400 })
      }
      await requireAssignable(user, [command.toUserId])
    }

    const handOver = command.action === 'hand_over' ? command : null
    await lockSentences(db(), sentenceIds)
    const active = (await db().taxonomy.findMany({ where: { isActive: true }, select: { id: true } })).map(t => t.id)
    let applied = 0
    const skipped: Record<string, number> = {}
    const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1)

    for (const sentenceId of sentenceIds) {
      if (command.action === 'release') {
        try {
          await releaseParts(user, sentenceId, command.userId, command.dryRun)
          applied++
        } catch (error) {
          if (!(error instanceof DoubleAnnotationError)) throw error
          skip(error.status === 403 ? 'Outside your team or labelled by you' : error.message)
        }
        continue
      }
      const round = await activeRound(sentenceId)
      if (!round) {
        skip('Not in double annotation')
        continue
      }
      try {
        // The preview applies the same manager check the commands do.
        if (command.dryRun && !(await canReview(user, round))) throw new DoubleAnnotationError('team', 403)
        if (command.action === 'accept_single') {
          if (command.dryRun) {
            if (round.outcomes.some(o => o.state === 'disagreed')) throw new DoubleAnnotationError('review', 409)
            if (round.outcomes.some(o => o.state === 'waiting' && !o.sourceTaskId))
              throw new DoubleAnnotationError('unlabelled', 409)
          } else {
            await acceptSingle(user, round, command.reason)
            await db().sentence.update({
              where: { id: sentenceId },
              data: { status: 'submitted', lastEditedAt: new Date(), lastEditorId: user.id }
            })
          }
        } else if (command.action === 'stop') {
          if (!command.dryRun) {
            await stopRound(user, round, command.reason)
            const done = (await completedTaxonomies(db(), [sentenceId], active)).get(sentenceId)
            await db().sentence.update({
              where: { id: sentenceId },
              data: { status: isComplete(done, active) ? 'submitted' : 'pending' }
            })
          }
        } else if (handOver) {
          const part = round.tasks.find(t => t.assigneeId === handOver.fromUserId)
          if (!part) {
            skip('The person has no part in it')
            continue
          }
          if (round.tasks.some(t => t.assigneeId === handOver.toUserId)) {
            skip('The new person already has a part')
            continue
          }
          if (part.status === 'submitted') {
            skip('The part is already done')
            continue
          }
          if (!command.dryRun) await reassignTask(user, round, part.position, handOver.toUserId)
        }
        applied++
      } catch (error) {
        if (!(error instanceof DoubleAnnotationError)) throw error
        skip(
          error.status === 403
            ? 'Outside your team or labelled by you'
            : command.action === 'accept_single' && /review|disagree/i.test(error.message)
              ? 'The two labels disagree: review first'
              : command.action === 'accept_single'
                ? 'A taxonomy has no label yet'
                : error.message
        )
      }
    }

    if (!command.dryRun && applied > 0) {
      await audit({
        actorId: user.id,
        action:
          command.action === 'accept_single'
            ? 'double.accepted_single'
            : command.action === 'stop'
              ? 'double.stopped'
              : command.action === 'release'
                ? 'double.released'
                : 'double.reassigned',
        entityType: 'sentence',
        entityId: sentenceIds[0]!,
        payload: {
          records: applied,
          skipped,
          ...(handOver
            ? { fromUserId: handOver.fromUserId, toUserId: handOver.toUserId }
            : { reason: 'reason' in command ? command.reason : null }),
          ...(command.action === 'release' ? { userId: command.userId } : {})
        }
      })
    }
    return NextResponse.json({ ok: true, applied, skipped })
  } catch (error) {
    if (error instanceof DoubleAnnotationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    await logError('Bulk double annotation command failed', error)
    return NextResponse.json({ ok: false, error: 'The change failed' }, { status: 500 })
  }
})
