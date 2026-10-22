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
  reassignTask,
  stopRound
} from '@/lib/server/double-annotation'

const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept_single'), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('stop'), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('reassign'), position: z.number().int().min(1).max(2), userId: z.string().min(1) })
])

/**
 * POST /api/workspaces/[workspaceId]/sentences/[sentenceId]/double-annotation
 *
 * A supervisor's or admin's command on the record's active round:
 * - accept_single: waive the missing second label (with a reason);
 * - stop: end double annotation; the record becomes ordinary work again;
 * - reassign: hand a part nobody started to another person.
 * Disagreements are decided through the annotations endpoint (a manager's save).
 */
export const POST = workspaceRoute<'sentenceId'>(['admin', 'supervisor'], async (req, { user, params }) => {
  try {
    const { sentenceId } = params
    const parsed = commandSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request data' }, { status: 400 })
    const command = parsed.data

    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied
    await lockSentences(db(), [sentenceId])
    const round = await activeRound(sentenceId)
    if (!round) {
      return NextResponse.json({ ok: false, error: 'This record is not in double annotation' }, { status: 409 })
    }

    if (command.action === 'accept_single') {
      await acceptSingle(user, round, command.reason)
      await db().sentence.update({
        where: { id: sentenceId },
        data: { status: 'submitted', lastEditedAt: new Date(), lastEditorId: user.id }
      })
    } else if (command.action === 'stop') {
      await stopRound(user, round, command.reason)
      // Ordinary work again: its current labels decide its status.
      const active = (await db().taxonomy.findMany({ where: { isActive: true }, select: { id: true } })).map(t => t.id)
      const done = (await completedTaxonomies(db(), [sentenceId], active)).get(sentenceId)
      await db().sentence.update({
        where: { id: sentenceId },
        data: { status: isComplete(done, active) ? 'submitted' : 'pending' }
      })
    } else {
      await reassignTask(user, round, command.position, command.userId)
    }

    await audit({
      actorId: user.id,
      action:
        command.action === 'accept_single'
          ? 'double.accepted_single'
          : command.action === 'stop'
            ? 'double.stopped'
            : 'double.reassigned',
      entityType: 'sentence',
      entityId: sentenceId,
      payload:
        command.action === 'reassign'
          ? { roundId: round.id, position: command.position, userId: command.userId }
          : { roundId: round.id, reason: command.reason }
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof DoubleAnnotationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    await logError('Double annotation command failed', error)
    return NextResponse.json({ ok: false, error: 'The change failed' }, { status: 500 })
  }
})
