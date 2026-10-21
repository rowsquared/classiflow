import { NextResponse } from 'next/server'
import type { Prisma } from '@/lib/generated/prisma/client'
import { workspaceRoute } from '@/lib/api-auth'
import { db } from '@/lib/workspace/db'

const MAX_LIMIT = 200

/**
 * Admin-only audit trail (lib/audit.ts), newest first.
 * Filters: action (exact, or a prefix ending in '.' such as "user."),
 * entityType, entityId, actorId. Paging: pass the previous response's
 * nextCursor as `cursor`.
 */
export const GET = workspaceRoute(['admin'], async req => {
  const params = req.nextUrl.searchParams
  const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), MAX_LIMIT)
  const action = params.get('action')
  const where: Prisma.AuditLogWhereInput = {}
  if (action) where.action = action.endsWith('.') ? { startsWith: action } : action
  for (const key of ['entityType', 'entityId', 'actorId'] as const) {
    const value = params.get(key)
    if (value) where[key] = value
  }
  const cursor = params.get('cursor')

  const entries = await db().auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      action: true,
      entityType: true,
      entityId: true,
      actorId: true,
      actorName: true,
      payload: true
    }
  })
  const hasMore = entries.length > limit
  const page = hasMore ? entries.slice(0, limit) : entries

  return NextResponse.json({
    ok: true,
    entries: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null
  })
})
