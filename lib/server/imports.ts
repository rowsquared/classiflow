import 'server-only'
import { db } from '@/lib/workspace/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { sentenceVisibilityFilter } from '@/lib/access'

export async function importDeletionPreview(workspaceId: string, id: string) {
  const record = await db().sentenceImport.findUnique({
    where: { id, workspaceId },
    select: { fileName: true, _count: { select: { sentences: true } } }
  })
  if (!record) return null
  const where: Prisma.SentenceWhereInput = {
    workspaceId,
    importId: id,
    OR: [{ annotations: { some: {} } }, { doubleTasks: { some: { labels: { some: {} } } } }]
  }
  const labelledRecords = await db().sentence.count({ where })
  return { fileName: record.fileName, records: record._count.sentences, labelledRecords }
}

// Record imports of one workspace for its admin page and /api/workspaces/[workspaceId]/imports.

/** Import history or the visible imports and record counts offered in the queue filter. */
export async function listImports(user: CurrentUser) {
  const scope = user.role === 'admin' ? undefined : await sentenceVisibilityFilter(user)
  const imports = await db().sentenceImport.findMany({
    where: { workspaceId: user.workspaceId, ...(scope && { sentences: { some: scope } }) },
    orderBy: { uploadedAt: 'desc' },
    include: {
      _count: {
        select: { sentences: scope ? { where: scope } : true }
      }
    }
  })

  return {
    ok: true as const,
    imports: imports.map(imp => ({
      id: imp.id,
      fileName: imp.fileName,
      uploadedAt: imp.uploadedAt.toISOString(),
      totalRows: scope ? imp._count.sentences : imp.totalRows,
      sentenceCount: imp._count.sentences
    }))
  }
}
