import 'server-only'
import { db } from '@/lib/workspace/db'

// Record imports of one workspace for its admin page and /api/workspaces/[workspaceId]/imports.

/** Every record import, newest first, with how many of its records remain. */
export async function listImports(workspaceId: string) {
  const imports = await db().sentenceImport.findMany({
    where: { workspaceId },
    orderBy: { uploadedAt: 'desc' },
    include: {
      _count: {
        select: { sentences: true }
      }
    }
  })

  return {
    ok: true as const,
    imports: imports.map(imp => ({
      id: imp.id,
      fileName: imp.fileName,
      uploadedAt: imp.uploadedAt.toISOString(),
      totalRows: imp.totalRows,
      sentenceCount: imp._count.sentences
    }))
  }
}
