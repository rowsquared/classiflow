import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace, scopeWorkspaceId } from '@/lib/workspace/db'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { sameLabels, validateLabelPath } from '@/lib/label-path'
import { completedTaxonomies, decideStatus, isComplete, lockSentences } from '@/lib/annotation-status'
import { Prisma, type SentenceStatus } from '@/lib/generated/prisma/client'
import { operationIdField, operationIdOrNew, recordLabelingActivity } from '@/lib/labeling-activity'
import { logError } from '@/lib/logger'
import {
  DoubleAnnotationError,
  activeRound,
  answeredTaxonomies,
  participantRound,
  recordChangedResult,
  reviewTaxonomy,
  saveTaskAnswer,
  setParticipantFlags,
  skipTask,
  viewFor
} from '@/lib/server/double-annotation'

// Codes are strings: a number would already have lost its leading zeros.
const annotationSchema = z.object({
  annotations: z
    .array(
      z.object({
        level: z.number().int().min(1).max(5),
        nodeCode: z.string().min(1).max(100),
        taxonomyKey: z.string().min(1)
      })
    )
    .max(5),
  status: z.enum(['pending', 'submitted', 'skipped', 'escalated']),
  flagged: z.boolean().optional(),
  comment: z.string().max(10_000).optional(),
  labelingStartedAt: z.string().optional(), // ISO timestamp when labeling started
  operationId: operationIdField, // retries of the same save record activity once
  reviewNote: z.string().max(2000).optional() // double annotation: the reviewer's note on a decision
})

class RequestError extends Error {}

/**
 * Saves one record: replaces the human labels of ONE taxonomy (others are kept),
 * optionally adds a comment and sets the flag, then recomputes the status with
 * the shared rules in lib/annotation-status.ts. An empty `annotations` array is
 * a flag/comment/skip-only save.
 *
 * Double annotation (lib/server/double-annotation.ts): a participant's labels
 * are their own answer (a new revision; in any round status, never the
 * result), a manager's labels decide a disagreement of an active round or,
 * on a completed round they may review, change the confirmed result; the
 * response describes the participant's own part (status, completed
 * taxonomies) or, for a manager, the confirmed taxonomies.
 */
export const POST = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams

    if (req.headers.get('x-warmup') === '1') {
      return NextResponse.json({ ok: true, warmup: true })
    }
    const userId = user.id

    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied

    const parsed = annotationSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
    }
    const { annotations, status, flagged, comment, labelingStartedAt, operationId, reviewNote } = parsed.data

    const taxonomyKeys = new Set(annotations.map(a => a.taxonomyKey))
    if (taxonomyKeys.size > 1) {
      return NextResponse.json({ error: 'All labels in one save must belong to the same taxonomy' }, { status: 400 })
    }

    let startTime: Date | null = null
    if (labelingStartedAt) {
      startTime = new Date(labelingStartedAt)
      if (Number.isNaN(startTime.getTime())) {
        return NextResponse.json({ error: 'labelingStartedAt is not a valid date' }, { status: 400 })
      }
    }

    let taxonomy: { id: string; maxDepth: number } | null = null
    const first = annotations[0]
    if (first) {
      taxonomy = await db().taxonomy.findUnique({
        where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key: first.taxonomyKey } },
        select: { id: true, maxDepth: true }
      })
      if (!taxonomy) {
        return NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
      }
      const pathError = await validateLabelPath(db(), taxonomy, annotations)
      if (pathError) {
        return NextResponse.json({ error: pathError }, { status: 400 })
      }
    }

    // Get active taxonomies before transaction (needed for completion check)
    const activeTaxonomies = await db().taxonomy.findMany({
      where: { isActive: true },
      select: { id: true, key: true }
    })
    const activeIds = activeTaxonomies.map(t => t.id)

    const result = await inCurrentWorkspace(async () => {
      const tx = db()
      await lockSentences(tx, [sentenceId])

      const current = await tx.sentence.findUnique({
        where: { id: sentenceId },
        select: { status: true }
      })
      if (!current) throw new RequestError('Sentence not found')

      // A participant (a part in any round of this record) always saves their
      // own answer, also after the round closed; it never changes the result.
      const part = await participantRound(user, sentenceId)
      if (part) {
        const { round, task } = part
        let recordStatus: SentenceStatus | null = null
        let personal: { status: string; done: Set<string> }
        if (taxonomy) {
          const saved = await saveTaskAnswer({
            user,
            round,
            task,
            taxonomyId: taxonomy.id,
            labels: annotations,
            labelingStartedAt: startTime,
            operationId: operationIdOrNew(operationId)
          })
          recordStatus = saved.recordStatus
          personal = { status: saved.taskDone ? 'submitted' : 'pending', done: saved.answeredTaxonomyIds }
        } else {
          if (status === 'skipped') await skipTask(task)
          personal = {
            status: status === 'skipped' && task.status === 'pending' ? 'skipped' : task.status,
            done: await answeredTaxonomies(task.id)
          }
        }
        if (flagged !== undefined) await setParticipantFlags(user, [sentenceId], flagged)
        if (comment && comment.trim()) {
          await tx.comment.create({
            data: { workspaceId: scopeWorkspaceId(), body: comment.trim(), sentenceId, authorId: userId }
          })
        }
        const updateData: Prisma.SentenceUncheckedUpdateInput = {}
        if (recordStatus) updateData.status = recordStatus
        if (taxonomy || comment) {
          updateData.lastEditedAt = new Date()
          updateData.lastEditorId = userId
        }
        if (Object.keys(updateData).length > 0)
          await tx.sentence.update({ where: { id: sentenceId }, data: updateData })
        return { finalStatus: personal.status, done: personal.done, required: round.outcomes }
      }

      const round = await activeRound(sentenceId)
      if (round) {
        const view = viewFor(user, round)
        let recordStatus = current.status
        if (view.mode === 'hidden') {
          throw new DoubleAnnotationError('You cannot edit labels on this record', 403)
        }
        if (taxonomy) {
          recordStatus = (
            await reviewTaxonomy({
              user,
              round,
              taxonomyId: taxonomy.id,
              labels: annotations,
              note: reviewNote,
              labelingStartedAt: startTime,
              operationId: operationIdOrNew(operationId)
            })
          ).recordStatus
        } else if (status === 'skipped' || status === 'escalated') {
          recordStatus = status // a manager's record-level decision
        }

        if (comment && comment.trim()) {
          await tx.comment.create({
            data: { workspaceId: scopeWorkspaceId(), body: comment.trim(), sentenceId, authorId: userId }
          })
        }
        const updateData: Prisma.SentenceUncheckedUpdateInput = { status: recordStatus }
        if (flagged !== undefined) updateData.flagged = flagged
        if (taxonomy || flagged !== undefined || comment || recordStatus !== current.status) {
          updateData.lastEditedAt = new Date()
          updateData.lastEditorId = userId
        }
        await tx.sentence.update({ where: { id: sentenceId }, data: updateData })

        const confirmed = await tx.doubleOutcome.findMany({
          where: { roundId: round.id, state: { in: ['agreed', 'reviewed', 'accepted_single'] } },
          select: { taxonomyId: true }
        })
        return { finalStatus: recordStatus, done: new Set(confirmed.map(c => c.taxonomyId)), required: round.outcomes }
      }

      let wroteLabels = false
      if (taxonomy) {
        const existing = await tx.sentenceAnnotation.findMany({
          where: { sentenceId, taxonomyId: taxonomy.id, source: 'user' },
          select: { level: true, nodeCode: true }
        })
        const changed = !sameLabels(existing, annotations)

        // Replace this taxonomy's labels only; other taxonomies are kept.
        await tx.sentenceAnnotation.deleteMany({
          where: { sentenceId, taxonomyId: taxonomy.id }
        })
        await tx.sentenceAnnotation.createMany({
          data: annotations.map(annotation => ({
            workspaceId: scopeWorkspaceId(),
            sentenceId,
            taxonomyId: taxonomy.id,
            level: annotation.level,
            nodeCode: annotation.nodeCode, // level-specific unknown code (-9, -99, ...) for unknown
            source: 'user' as const,
            labelingStartedAt: startTime,
            createdById: userId
          }))
        })
        wroteLabels = true
        await recordLabelingActivity(tx, {
          workspaceId: scopeWorkspaceId(),
          sentenceIds: [sentenceId],
          taxonomyId: taxonomy.id,
          actorId: userId,
          operationId: operationIdOrNew(operationId)
        })

        // Learning counter unit: label rows of a changed path. Re-saving the same
        // path does not count again.
        if (changed) {
          await tx.taxonomy.update({
            where: { id: taxonomy.id },
            data: { newAnnotationsSinceLastLearning: { increment: annotations.length } }
          })
          // A completed double annotation: a reviewer's change is their decision.
          await recordChangedResult(user, sentenceId, taxonomy.id, annotations)
        }
      }

      if (comment && comment.trim()) {
        await tx.comment.create({
          data: {
            workspaceId: scopeWorkspaceId(),
            body: comment.trim(),
            sentenceId,
            authorId: userId
          }
        })
      }

      const done = (await completedTaxonomies(tx, [sentenceId], activeIds)).get(sentenceId)!
      const finalStatus = decideStatus({
        requested: status,
        current: current.status,
        wroteLabels,
        complete: isComplete(done, activeIds)
      })

      const updateData: Prisma.SentenceUncheckedUpdateInput = { status: finalStatus }
      if (flagged !== undefined) {
        updateData.flagged = flagged
      }
      if (current.status !== finalStatus || wroteLabels || flagged !== undefined || comment) {
        updateData.lastEditedAt = new Date()
        updateData.lastEditorId = userId
      }
      await tx.sentence.update({ where: { id: sentenceId }, data: updateData })

      return { finalStatus, done, required: null }
    })

    const completedKeys = activeTaxonomies.filter(t => result.done.has(t.id)).map(t => t.key)
    // Double annotation: done means every taxonomy the round requires.
    const requiredIds = result.required ? result.required.map(o => o.taxonomyId) : activeIds

    return NextResponse.json({
      success: true,
      status: result.finalStatus,
      completedTaxonomies: completedKeys,
      allCompleted: requiredIds.length > 0 && requiredIds.every(id => result.done.has(id))
    })
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof DoubleAnnotationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    await logError('Annotation submission failed', error)
    return NextResponse.json({ error: 'Failed to save labels' }, { status: 500 })
  }
})
