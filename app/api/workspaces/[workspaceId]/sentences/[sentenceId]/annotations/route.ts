import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace, scopeWorkspaceId } from '@/lib/workspace/db'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { sameLabels, validateLabelPath } from '@/lib/label-path'
import { completedTaxonomies, decideStatus, isComplete, lockSentences } from '@/lib/annotation-status'
import { Prisma } from '@/lib/generated/prisma/client'

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
  labelingStartedAt: z.string().optional() // ISO timestamp when labeling started
})

class RequestError extends Error {}

/**
 * Saves one record: replaces the human labels of ONE taxonomy (others are kept),
 * optionally adds a comment and sets the flag, then recomputes the status with
 * the shared rules in lib/annotation-status.ts. An empty `annotations` array is
 * a flag/comment/skip-only save.
 */
export const POST = workspaceRoute([], async (req, { user, params: routeParams }) => {
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
    const { annotations, status, flagged, comment, labelingStartedAt } = parsed.data

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
    if (annotations.length > 0) {
      taxonomy = await db().taxonomy.findUnique({
        where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key: annotations[0].taxonomyKey } },
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

        // Learning counter unit: label rows of a changed path. Re-saving the same
        // path does not count again.
        if (changed) {
          await tx.taxonomy.update({
            where: { id: taxonomy.id },
            data: { newAnnotationsSinceLastLearning: { increment: annotations.length } }
          })
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

      return { finalStatus, done }
    })

    const completedKeys = activeTaxonomies.filter(t => result.done.has(t.id)).map(t => t.key)

    return NextResponse.json({
      success: true,
      status: result.finalStatus,
      completedTaxonomies: completedKeys,
      allCompleted: activeTaxonomies.length > 0 && completedKeys.length === activeTaxonomies.length
    })
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('Annotation submission error:', error)
    return NextResponse.json({ error: 'Failed to save labels' }, { status: 500 })
  }
})
