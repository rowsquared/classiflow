import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { audit } from '@/lib/audit'

export const DELETE = workspaceRoute(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const { id } = routeParams

    // Check if import exists
    const importRecord = await db().sentenceImport.findUnique({
      where: { id },
      include: {
        _count: { select: { sentences: true } }
      }
    })

    if (!importRecord) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Import not found' 
      }, { status: 404 })
    }

    // Delete in transaction: annotations, comments, assignments first, then sentences, then import
    await inCurrentWorkspace(async () => {
      const tx = db()
      // Get all sentence IDs for this import
      const sentences = await tx.sentence.findMany({
        where: { importId: id },
        select: { id: true }
      })
      const sentenceIds = sentences.map(s => s.id)

      if (sentenceIds.length > 0) {
        // Delete annotations first (they reference sentences)
        await tx.sentenceAnnotation.deleteMany({
          where: { sentenceId: { in: sentenceIds } }
        })

        // Delete comments
        await tx.comment.deleteMany({
          where: { sentenceId: { in: sentenceIds } }
        })

        // Delete assignments (has onDelete: Cascade but let's be explicit)
        await tx.sentenceAssignment.deleteMany({
          where: { sentenceId: { in: sentenceIds } }
        })
      }

      // Delete sentences (cascade from import, but we've already cleaned up dependencies)
      await tx.sentence.deleteMany({
        where: { importId: id }
      })

      // Finally delete the import
      await tx.sentenceImport.delete({
        where: { id }
      })
    })

    await audit({
      actorId: actor.id, action: 'import.deleted', entityType: 'import', entityId: id,
      payload: { fileName: importRecord.fileName, records: importRecord._count.sentences },
    })
    return NextResponse.json({ 
      ok: true, 
      deletedSentences: importRecord._count.sentences 
    })

  } catch (caught) {

    const e = caught as CaughtError
    console.error('Failed to delete import:', e)
    return NextResponse.json({ 
      ok: false, 
      error: e?.message || String(e) 
    }, { status: 500 })
  }
})

