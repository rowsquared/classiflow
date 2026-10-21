import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parse } from 'csv-parse/sync'
import { requireSession } from '@/lib/api-auth'
import { readUpload } from '@/lib/upload'
import type { CaughtError, CsvRow } from '@/lib/utils'
import { Prisma } from '@prisma/client'
import { audit } from '@/lib/audit'

const BATCH_SIZE = 1000
const MAX_FIELD_COLUMNS = 5
const MAX_SUPPORT_COLUMNS = 5

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession('admin')
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const dryRunParam = searchParams.get('dryRun')
    // Convert string 'false' to boolean false, anything else defaults to true
    const dryRun = dryRunParam === 'false' ? false : true
    const sp = { dryRun }

    // Get the file from FormData
    const formData = await req.formData()
    const upload = await readUpload(formData.get('file'))
    if (!upload.ok) {
      return NextResponse.json({ error: upload.error }, { status: 400 })
    }

    const fileName = upload.name
    const csvText = upload.text

    // Parse CSV (no casting: ids and values stay strings, leading zeros kept)
    let headers: string[] = []
    let records: CsvRow[]
    try {
      records = parse(csvText, {
        columns: (header: string[]) => {
          headers = header.map(h => String(h).trim())
          return headers
        },
        skip_empty_lines: true, 
        bom: true,
        trim: true
      })
    } catch (caught) {
      const e = caught as CaughtError
      return NextResponse.json({ 
        error: 'Failed to parse CSV', 
        details: e.message 
      }, { status: 400 })
    }

    if (records.length === 0) {
      return NextResponse.json({ 
        error: 'CSV file is empty' 
      }, { status: 400 })
    }

    // Extract and validate headers
    const duplicateHeaders = headers.filter((h, i) => headers.indexOf(h) !== i)
    if (duplicateHeaders.length > 0) {
      return NextResponse.json({
        ok: false,
        errors: [`Duplicate columns: ${Array.from(new Set(duplicateHeaders)).join(', ')}`]
      }, { status: 400 })
    }
    const hasIdColumn = headers.includes('id')
    
    const fieldColumns = headers
      .filter(h => h.startsWith('field_'))
    
    const supportColumns = headers
      .filter(h => h.startsWith('support_'))
    
    const invalidColumns = headers.filter(h => 
      h !== 'id' && 
      !h.startsWith('field_') && 
      !h.startsWith('support_')
    )

    // Validation
    const errors: string[] = []

    if (invalidColumns.length > 0) {
      errors.push(`Invalid columns found: ${invalidColumns.join(', ')}. Only 'id', 'field_*', and 'support_*' are allowed.`)
    }


    if (fieldColumns.length > MAX_FIELD_COLUMNS) {
      errors.push(`Too many field columns (${fieldColumns.length}). Maximum is ${MAX_FIELD_COLUMNS}`)
    }

    if (supportColumns.length > MAX_SUPPORT_COLUMNS) {
      errors.push(`Too many support columns (${supportColumns.length}). Maximum is ${MAX_SUPPORT_COLUMNS}`)
    }

    if (errors.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        errors 
      }, { status: 400 })
    }

    // Build field and support mappings (preserve CSV order)
    const fieldMapping: Record<string, string> = {}
    fieldColumns.forEach((col, idx) => {
      const fieldName = col.substring(6) // Remove 'field_' prefix
      fieldMapping[String(idx + 1)] = fieldName
    })

    const supportMapping: Record<string, string> = {}
    supportColumns.forEach((col, idx) => {
      const fieldName = col.substring(8) // Remove 'support_' prefix
      supportMapping[String(idx + 1)] = fieldName
    })

    if (fieldColumns.length === 0) {
      return NextResponse.json({
        ok: false,
        errors: ['CSV must contain at least one field_* column']
      }, { status: 400 })
    }

    // Process records
    const sentences: Omit<Prisma.SentenceCreateManyInput, 'importId'>[] = [] // importId is added on insert
    const providedIds = new Set<string>()
    const rowErrors: { row: number; message: string }[] = []

    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx]
      const rowNum = idx + 2 // +2 for header and 0-index

      // Handle ID
      let sentenceId: string
      if (hasIdColumn) {
        if (!record.id || record.id.trim() === '') {
          rowErrors.push({ row: rowNum, message: 'Empty ID value' })
          continue
        }
        sentenceId = record.id.trim()
        
        if (sentenceId.length > 191) {
          rowErrors.push({ row: rowNum, message: 'ID is longer than 191 characters' })
          continue
        }
        if (providedIds.has(sentenceId)) {
          rowErrors.push({ row: rowNum, message: `Duplicate ID: ${sentenceId}` })
          continue
        }
        providedIds.add(sentenceId)
      } else {
        // Will be generated as cuid() during insert
        sentenceId = '' // Placeholder
      }

      // Extract field values
      const field1 = fieldColumns[0]
        ? (() => {
            const raw = record[fieldColumns[0]]
            if (raw === undefined || raw === null) return ''
            const value = String(raw).trim()
            return value
          })()
        : ''
      const field2 = fieldColumns[1] ? (record[fieldColumns[1]]?.trim() || null) : null
      const field3 = fieldColumns[2] ? (record[fieldColumns[2]]?.trim() || null) : null
      const field4 = fieldColumns[3] ? (record[fieldColumns[3]]?.trim() || null) : null
      const field5 = fieldColumns[4] ? (record[fieldColumns[4]]?.trim() || null) : null

      // Extract support values
      const support1 = supportColumns[0] ? record[supportColumns[0]]?.trim() || null : null
      const support2 = supportColumns[1] ? record[supportColumns[1]]?.trim() || null : null
      const support3 = supportColumns[2] ? record[supportColumns[2]]?.trim() || null : null
      const support4 = supportColumns[3] ? record[supportColumns[3]]?.trim() || null : null
      const support5 = supportColumns[4] ? record[supportColumns[4]]?.trim() || null : null

      sentences.push({
        id: sentenceId,
        importOrder: rowNum, // Track row number from CSV for stable sorting
        field1,
        field2,
        field3,
        field4,
        field5,
        support1,
        support2,
        support3,
        support4,
        support5,
        fieldMapping,
        supportMapping: Object.keys(supportMapping).length > 0 ? supportMapping : undefined
      })
    }

    if (rowErrors.length > 0) {
      const formattedErrors = rowErrors.slice(0, 200).map(err => `Row ${err.row}: ${err.message}`)
      return NextResponse.json({ 
        ok: false, 
        errors: formattedErrors 
      }, { status: 400 })
    }

    // Check for existing IDs in database
    if (hasIdColumn && providedIds.size > 0) {
      const existing = await prisma.sentence.findMany({
        where: { id: { in: Array.from(providedIds) } },
        select: { id: true }
      })

      if (existing.length > 0) {
        return NextResponse.json({ 
          ok: false, 
          errors: [`${existing.length} ID(s) already exist in the database, e.g. ${existing.slice(0, 20).map(e => e.id).join(', ')}`]
        }, { status: 400 })
      }
    }

    // Dry-run response
    if (sp.dryRun) {
      return NextResponse.json({ 
        ok: true, 
        dryRun: true,
        summary: {
          totalRows: sentences.length,
          hasIdColumn,
          fieldColumns: fieldColumns.map(c => c.substring(6)),
          supportColumns: supportColumns.map(c => c.substring(8)),
          fieldMapping,
          supportMapping: Object.keys(supportMapping).length > 0 ? supportMapping : undefined
        }
      })
    }

    // Commit import
    // Calculate timeout: 1 minute per 10k rows, minimum 30 seconds, maximum 30 minutes
    const estimatedSeconds = Math.max(30, Math.min(1800, Math.ceil(sentences.length / 10000) * 60))
    const timeoutMs = estimatedSeconds * 1000
    
    const importId = await prisma.$transaction(async (tx) => {
      // Create import record
      const sentenceImport = await tx.sentenceImport.create({
        data: {
          fileName,
          totalRows: sentences.length,
          uploadedById: user.id
        }
      })

      const importId = sentenceImport.id

      // Insert sentences in batches using createMany for performance
      for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        const chunk = sentences.slice(i, i + BATCH_SIZE)
        
        await tx.sentence.createMany({
          data: chunk.map(s => ({
            ...(hasIdColumn && { id: s.id }), // Only include id if provided
            importId,
            importOrder: s.importOrder, // Include import order for stable sorting
            field1: s.field1,
            field2: s.field2,
            field3: s.field3,
            field4: s.field4,
            field5: s.field5,
            support1: s.support1,
            support2: s.support2,
            support3: s.support3,
            support4: s.support4,
            support5: s.support5,
            fieldMapping: s.fieldMapping,
            supportMapping: s.supportMapping
          }))
        })
      }

      return importId
    }, {
      maxWait: timeoutMs, // Maximum time to wait for a transaction slot
      timeout: timeoutMs  // Maximum time the transaction can run
    })

    await audit({
      actorId: user.id, action: 'records.imported', entityType: 'import', entityId: importId,
      payload: { fileName, records: sentences.length },
    })
    return NextResponse.json({ 
      ok: true, 
      dryRun: false, 
      count: sentences.length,
      importId
    })

  } catch (caught) {

    const e = caught as CaughtError
    // Another import committed one of these ids between the check and the insert.
    if (e?.code === 'P2002') {
      return NextResponse.json({ ok: false, errors: ['Some IDs already exist in the database; nothing was imported'] }, { status: 409 })
    }
    console.error('Import error:', e)
    return NextResponse.json({
      ok: false,
      error: 'Import failed; nothing was imported'
    }, { status: 500 })
  }
}
