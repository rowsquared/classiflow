import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { lockSentences } from '@/lib/annotation-status'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/logger'
import { db } from '@/lib/workspace/db'
import {
  DoubleAnnotationError,
  planStart,
  requireAssignable,
  startRounds,
  type StartCategory
} from '@/lib/server/double-annotation'

const countsSchema = z.object({
  fresh: z.number().int(),
  labelled: z.number().int(),
  already: z.number().int(),
  needs_first: z.number().int()
})

const startSchema = z.object({
  sentenceIds: z.array(z.string()).min(1).max(10000),
  // Optional when every selected record is already labelled by one person.
  firstUserId: z.string().min(1).nullable().optional(),
  secondUserId: z.string().min(1),
  dryRun: z.boolean().optional(),
  // The counts the preview showed; a commit whose selection changed since is refused.
  expect: countsSchema.optional()
})

/**
 * POST /api/workspaces/[workspaceId]/sentences/double-annotation
 *
 * Starts double annotation for the selected records with two people (or one
 * more person for records someone already labelled). `dryRun: true` returns
 * what would happen per category without changing anything (the assignment
 * dialog's preview); a commit must send the counts it showed as `expect`.
 * Records already in double annotation are left unchanged; records that need
 * two people when only one was chosen are left out (both are reported).
 */
export const POST = workspaceRoute(['admin', 'supervisor'], async (req, { user }) => {
  try {
    const parsed = startSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request data' }, { status: 400 })
    const { firstUserId = null, secondUserId, dryRun, expect } = parsed.data
    const sentenceIds = Array.from(new Set(parsed.data.sentenceIds))
    if (firstUserId === secondUserId) {
      return NextResponse.json({ ok: false, error: 'Choose two different people' }, { status: 400 })
    }

    const denied = await denyUnlessSentencesVisible(user, sentenceIds)
    if (denied) return denied
    await requireAssignable(user, firstUserId ? [firstUserId, secondUserId] : [secondUserId])

    if (!dryRun) await lockSentences(db(), sentenceIds)
    const plan = await planStart(sentenceIds, firstUserId, secondUserId)
    if (dryRun) return NextResponse.json({ ok: true, counts: plan.counts })

    if (!expect) {
      return NextResponse.json({ ok: false, error: 'Preview the change first' }, { status: 400 })
    }
    const categories = Object.keys(plan.counts) as StartCategory[]
    if (categories.some(c => plan.counts[c] !== expect[c])) {
      return NextResponse.json(
        {
          ok: false,
          error: 'The selected records changed since the preview. Check the summary again.',
          counts: plan.counts
        },
        { status: 409 }
      )
    }

    const started = await startRounds(user, plan)
    await audit({
      actorId: user.id,
      action: 'double.started',
      entityType: 'sentence',
      entityId: sentenceIds[0]!,
      payload: { records: started, counts: plan.counts, firstUserId, secondUserId }
    })
    return NextResponse.json({ ok: true, started, counts: plan.counts })
  } catch (error) {
    if (error instanceof DoubleAnnotationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    await logError('Starting double annotation failed', error)
    return NextResponse.json({ ok: false, error: 'Starting double annotation failed' }, { status: 500 })
  }
})
