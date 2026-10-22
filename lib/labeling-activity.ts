import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@/lib/generated/prisma/client'

/**
 * Labeling activity (prisma/schema.prisma LabelingActivity): the history the
 * progress reports count. Written by the single and bulk label saves inside
 * their transaction, one row per record that got human labels in this save.
 * Flag-, comment- and skip-only saves and AI suggestions write nothing.
 */

/**
 * Optional `operationId` in a label save's body: a client-chosen id for this
 * save. Sending the same request again (a retry after a lost response) then
 * records no second activity. Without one, each request is its own operation.
 */
export const operationIdField = z.uuid({ error: 'operationId must be a UUID' }).optional()

export function operationIdOrNew(operationId: string | undefined): string {
  return operationId ?? randomUUID()
}

export async function recordLabelingActivity(
  tx: Prisma.TransactionClient,
  event: {
    workspaceId: string
    sentenceIds: string[]
    taxonomyId: string
    actorId: string
    operationId: string
    /** review: a decision on a double-annotation disagreement (lib/server/double-annotation.ts). */
    kind?: 'label' | 'review'
  }
): Promise<void> {
  if (event.sentenceIds.length === 0) return
  await tx.labelingActivity.createMany({
    data: event.sentenceIds.map(sentenceId => ({
      workspaceId: event.workspaceId,
      sentenceId,
      taxonomyId: event.taxonomyId,
      actorId: event.actorId,
      operationId: event.operationId,
      kind: event.kind ?? 'label'
    })),
    // Replay of the same operation: the (workspace, operation, record) rows exist.
    skipDuplicates: true
  })
}
