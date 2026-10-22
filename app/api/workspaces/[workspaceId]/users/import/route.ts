import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { MEMBER_IMPORT_MAX_BYTES } from '@/lib/member-import'
import { commitImport, ImportChangedError, importOutcome, prepareImport, previewRows } from '@/lib/server/member-import'

const IMPORT_KEY = /^[A-Za-z0-9-]{8,100}$/
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * CSV member import (workspace admins). `?dryRun=true` (default) validates and
 * returns every row with its outcome (lib/server/member-import.ts) and its
 * errors; nothing is written or mailed. With `dryRun=false` the same file is
 * validated again and every row is applied in one transaction, or none.
 * Restoring removed members needs the form field `confirmRestore=true`. The form field `importKey` identifies
 * the commit: sending it again returns the first outcome. Generated passwords
 * (access `generate`) appear only in that first commit response.
 *
 * Not one transaction for the whole request: hashing up to 500 passwords
 * happens before the (short) write transaction.
 */
export const POST = workspaceRoute(
  ['admin'],
  async (req, { user }) => {
    const dryRun = new URL(req.url).searchParams.get('dryRun') !== 'false'
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > MEMBER_IMPORT_MAX_BYTES) {
      return NextResponse.json({ ok: false, fileErrors: ['The file is larger than 1 MB'] }, { status: 400 })
    }
    const importKey = form?.get('importKey')
    if (!dryRun && (typeof importKey !== 'string' || !IMPORT_KEY.test(importKey))) {
      return NextResponse.json({ error: 'importKey is required to commit' }, { status: 400 })
    }

    // A replay of a committed import: its outcome, nothing created or mailed.
    if (!dryRun) {
      const stored = await importOutcome(user.workspaceId, { importKey: importKey as string })
      if (stored) return NextResponse.json({ ok: true, replayed: true, ...stored }, { headers: NO_STORE })
    }

    const prepared = await prepareImport(user, await file.text())
    if (prepared.fileErrors.length) {
      return NextResponse.json({ ok: false, fileErrors: prepared.fileErrors }, { status: 400 })
    }
    const preview = { rows: previewRows(prepared.rows), errors: prepared.errors }
    if (dryRun) return NextResponse.json({ ok: prepared.errors.length === 0, dryRun: true, ...preview })
    if (prepared.errors.length) return NextResponse.json({ ok: false, ...preview }, { status: 400 })

    try {
      const result = await commitImport(user, {
        importKey: importKey as string,
        fileName: file.name.slice(0, 255),
        rows: prepared.rows,
        confirmRestore: form?.get('confirmRestore') === 'true'
      })
      if (!result) {
        const stored = await importOutcome(user.workspaceId, { importKey: importKey as string })
        return NextResponse.json({ ok: true, replayed: true, ...stored }, { headers: NO_STORE })
      }
      return NextResponse.json({ ok: true, ...result }, { status: 201, headers: NO_STORE })
    } catch (caught) {
      if (caught instanceof ImportChangedError) {
        return NextResponse.json({ ok: false, rows: preview.rows, errors: caught.errors }, { status: 409 })
      }
      throw caught
    }
  },
  { transaction: false }
)
