import 'server-only'
import { prisma } from '@/lib/prisma'

// Record imports for the admin page (app/admin/sentences) and /api/imports.

/** Every record import, newest first, with how many of its records remain. */
export async function listImports() {
  const imports = await prisma.sentenceImport.findMany({
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
