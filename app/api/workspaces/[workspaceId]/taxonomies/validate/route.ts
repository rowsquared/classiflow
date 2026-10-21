import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { readUpload } from '@/lib/upload'
import { logError } from '@/lib/logger'

// Dry run for taxonomy creation/replacement: the same parser the commit uses.
export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  try {
    const formData = await req.formData()
    const upload = await readUpload(formData.get('file'))
    if (!upload.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: upload.error,
          errors: [{ row: 0, message: upload.error }]
        },
        { status: 400 }
      )
    }

    const { nodes, errors } = parseTaxonomyCsv(upload.text)
    if (errors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: formatCsvErrors(errors),
          errors
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: `File is valid! Found ${nodes.length} records.`,
      recordCount: nodes.length
    })
  } catch (caught) {
    await logError('Taxonomy validation failed', caught)
    return NextResponse.json(
      {
        ok: false,
        error: 'An unexpected error occurred during validation',
        errors: [{ row: 0, message: 'An unexpected error occurred during validation' }]
      },
      { status: 500 }
    )
  }
})
