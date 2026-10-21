import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace, scopeWorkspaceId } from '@/lib/workspace/db'
import { z } from 'zod'
import { Prisma } from '@/lib/generated/prisma/client'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { sameLabels, validateLabelPath } from '@/lib/label-path'
import { completedTaxonomies, decideStatus, isComplete, lockSentences } from '@/lib/annotation-status'
import { audit } from '@/lib/audit'
import { operationIdField, operationIdOrNew, recordLabelingActivity } from '@/lib/labeling-activity'
import { logError } from '@/lib/logger'

// Codes are strings: a number would already have lost its leading zeros.
const bulkLabelSchema = z.object({
  sentenceIds: z.array(z.string()).min(1).max(10000),
  taxonomyKey: z.string().min(1),
  annotations: z
    .array(
      z.object({
        level: z.number().int().min(1).max(5),
        nodeCode: z.string().min(1).max(100)
      })
    )
    .max(5)
    .optional(),
  flagged: z.boolean().optional(),
  comment: z.string().max(10_000).optional(),
  labelingStartedAt: z.string().optional(), // ISO timestamp when bulk panel opened
  operationId: operationIdField // retries of the same save record activity once
})

class MissingRecordError extends Error {}

/**
 * Applies one label path (for one taxonomy) and/or a flag/comment to many
 * records at once. Same rules as the single-record endpoint: the path is
 * validated, each record's status is recomputed (submitted only when every
 * active taxonomy has human labels), and a flag/comment-only request leaves
 * statuses alone. All-or-nothing.
 */
export const POST = workspaceRoute([], async (req, { user }) => {
  try {
    const validation = bulkLabelSchema.safeParse(await req.json())
    if (!validation.success) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Invalid request data'
        },
        { status: 400 }
      )
    }

    const { taxonomyKey, annotations = [], flagged, comment, labelingStartedAt, operationId } = validation.data
    const sentenceIds = Array.from(new Set(validation.data.sentenceIds))

    // All-or-nothing: one record outside the caller's scope rejects the request.
    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied

    const taxonomy = await db().taxonomy.findUnique({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key: taxonomyKey } },
      select: { id: true, maxDepth: true }
    })
    if (!taxonomy) {
      return NextResponse.json(
        {
          ok: false,
          error: `Taxonomy '${taxonomyKey}' not found`
        },
        { status: 404 }
      )
    }

    if (annotations.length > 0) {
      const pathError = await validateLabelPath(db(), taxonomy, annotations)
      if (pathError) {
        return NextResponse.json({ ok: false, error: pathError }, { status: 400 })
      }
    }

    const startTime = labelingStartedAt ? new Date(labelingStartedAt) : null
    if (startTime && Number.isNaN(startTime.getTime())) {
      return NextResponse.json({ ok: false, error: 'labelingStartedAt is not a valid date' }, { status: 400 })
    }

    const activeIds = (
      await db().taxonomy.findMany({
        where: { isActive: true },
        select: { id: true }
      })
    ).map(t => t.id)

    const wroteLabels = annotations.length > 0
    const trimmedComment = comment?.trim()

    const labeled = await inCurrentWorkspace(async () => {
      const tx = db()
      await lockSentences(tx, sentenceIds)

      const current = await tx.sentence.findMany({
        where: { id: { in: sentenceIds } },
        select: { id: true, status: true }
      })
      if (current.length !== sentenceIds.length) {
        throw new MissingRecordError()
      }

      if (wroteLabels) {
        const existing = await tx.sentenceAnnotation.findMany({
          where: { sentenceId: { in: sentenceIds }, taxonomyId: taxonomy.id, source: 'user' },
          select: { sentenceId: true, level: true, nodeCode: true }
        })
        const existingBySentence = new Map<string, Array<{ level: number; nodeCode: string }>>()
        existing.forEach(a => {
          if (!existingBySentence.has(a.sentenceId)) existingBySentence.set(a.sentenceId, [])
          existingBySentence.get(a.sentenceId)!.push(a)
        })
        const changedCount = sentenceIds.filter(id => !sameLabels(existingBySentence.get(id) ?? [], annotations)).length

        await tx.sentenceAnnotation.deleteMany({
          where: { sentenceId: { in: sentenceIds }, taxonomyId: taxonomy.id }
        })
        await tx.sentenceAnnotation.createMany({
          data: sentenceIds.flatMap(sentenceId =>
            annotations.map(ann => ({
              workspaceId: scopeWorkspaceId(),
              sentenceId,
              taxonomyId: taxonomy.id,
              level: ann.level,
              nodeCode: ann.nodeCode, // level-specific unknown code for unknown
              source: 'user' as const,
              createdById: user.id,
              labelingStartedAt: startTime
            }))
          )
        })

        await recordLabelingActivity(tx, {
          workspaceId: scopeWorkspaceId(),
          sentenceIds,
          taxonomyId: taxonomy.id,
          actorId: user.id,
          operationId: operationIdOrNew(operationId)
        })

        // Learning counter unit: label rows of changed paths (see single endpoint).
        if (changedCount > 0) {
          await tx.taxonomy.update({
            where: { id: taxonomy.id },
            data: { newAnnotationsSinceLastLearning: { increment: changedCount * annotations.length } }
          })
        }
      }

      if (trimmedComment) {
        await tx.comment.createMany({
          data: sentenceIds.map(sentenceId => ({
            workspaceId: user.workspaceId,
            body: trimmedComment,
            sentenceId,
            authorId: user.id
          }))
        })
      }

      const done = await completedTaxonomies(tx, sentenceIds, activeIds)
      const now = new Date()
      for (const { id, status } of current) {
        const updateData: Prisma.SentenceUncheckedUpdateInput = {
          status: decideStatus({ current: status, wroteLabels, complete: isComplete(done.get(id), activeIds) }),
          lastEditorId: user.id,
          lastEditedAt: now
        }
        if (flagged !== undefined) {
          updateData.flagged = flagged
        }
        await tx.sentence.update({ where: { id }, data: updateData })
      }
      return current.length
    })

    await audit({
      actorId: user.id,
      action: 'labels.bulk_applied',
      entityType: 'taxonomy',
      entityId: taxonomy.id,
      payload: {
        taxonomyKey,
        records: labeled,
        codes: annotations.map(a => `${a.level}:${a.nodeCode}`),
        ...(flagged !== undefined ? { flagged } : {})
      }
    })
    return NextResponse.json({
      ok: true,
      labeled,
      message: `Successfully labeled ${labeled} sentence(s)`
    })
  } catch (error) {
    if (error instanceof MissingRecordError) {
      return NextResponse.json({ ok: false, error: 'One or more records do not exist' }, { status: 404 })
    }
    await logError('Bulk label failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'Bulk labelling failed'
      },
      { status: 500 }
    )
  }
})
