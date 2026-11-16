import { NextResponse } from 'next/server'
import { db } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { importDeletionPreview } from '@/lib/server/imports'

export const GET = workspaceRoute<'id'>(['admin'], async (_req, { user, params: { id } }) => {
  const preview = await importDeletionPreview(user.workspaceId, id)
  return preview ? NextResponse.json(preview) : NextResponse.json({ error: 'Import not found' }, { status: 404 })
})

export const DELETE = workspaceRoute<'id'>(['admin'], async (req, { user, params: { id } }) => {
  const tx = db()
  // Serialize deletion and label saves so the confirmed count cannot miss newly saved labels.
  const locked = await tx.$queryRaw<unknown[]>`
    SELECT id FROM "SentenceImport" WHERE "workspaceId" = ${user.workspaceId} AND id = ${id} FOR UPDATE`
  if (locked.length === 0) return NextResponse.json({ error: 'Import not found' }, { status: 404 })

  await tx.$queryRaw`
    SELECT count(*) FROM (
      SELECT id FROM "Sentence" WHERE "workspaceId" = ${user.workspaceId} AND "importId" = ${id}
      ORDER BY id FOR UPDATE
    ) AS locked_records`
  const preview = await importDeletionPreview(user.workspaceId, id)
  if (!preview) return NextResponse.json({ error: 'Import not found' }, { status: 404 })
  if (
    preview.labelledRecords > 0 &&
    req.nextUrl.searchParams.get('confirmLabelledRecords') !== String(preview.labelledRecords)
  ) {
    return NextResponse.json({ error: 'Confirm deletion of the current labelled records', ...preview }, { status: 409 })
  }

  const sentence = { workspaceId: user.workspaceId, importId: id }
  await tx.sentenceAnnotation.deleteMany({ where: { sentence } })
  await tx.comment.deleteMany({ where: { sentence } })
  await tx.sentenceImport.delete({ where: { id } })
  await audit({
    actorId: user.id,
    action: 'import.deleted',
    entityType: 'import',
    entityId: id,
    payload: preview
  })
  return NextResponse.json({ ok: true, deletedSentences: preview.records })
})
