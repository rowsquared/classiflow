import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parse } from 'csv-parse/sync'

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const taxonomyKey = formData.get('taxonomyKey') as string | null

    if (!file) {
      return NextResponse.json({ 
        ok: false, 
        error: 'No file provided',
        errors: [{ row: 0, message: 'No file provided' }]
      }, { status: 400 })
    }

    if (!taxonomyKey) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy key is required',
        errors: [{ row: 0, message: 'Taxonomy key is required' }]
      }, { status: 400 })
    }

    // Get taxonomy
    const taxonomy = await prisma.taxonomy.findUnique({
      where: { key: taxonomyKey, isActive: true },
      include: {
        nodes: {
          select: { code: true, level: true }
        }
      }
    })

    if (!taxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy not found',
        errors: [{ row: 0, message: `Taxonomy "${taxonomyKey}" not found` }]
      }, { status: 404 })
    }

    // Get existing field columns from sentences
    const sampleSentence = await prisma.sentence.findFirst({
      select: { fieldMapping: true }
    })

    const existingFieldNames = sampleSentence?.fieldMapping 
      ? Object.values(sampleSentence.fieldMapping as Record<string, string>)
      : []

    // Parse CSV
    const buffer = Buffer.from(await file.arrayBuffer())
    const csv = buffer.toString('utf-8')
    
    let records: any[]
    try {
      records = parse(csv, { 
        columns: true, 
        skip_empty_lines: true, 
        bom: true,
        cast: false,
        skip_records_with_error: false
      }) as any[]
    } catch (parseError: any) {
      return NextResponse.json({ 
        ok: false, 
        error: `CSV parsing error: ${parseError.message}`,
        errors: [{ row: 0, message: `CSV parsing error: ${parseError.message}` }]
      }, { status: 400 })
    }

    if (!records || records.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'CSV file is empty or contains no data rows',
        errors: [{ row: 0, message: 'CSV file is empty or contains no data rows' }]
      }, { status: 400 })
    }

    const headers = Object.keys(records[0] || {})
    const validationErrors: Array<{ row: number; message: string }> = []

    // Extract field columns and taxonomy columns
    const fieldColumns = headers.filter(h => h.startsWith('field_'))
    // Taxonomy columns can be in any case (e.g., ISCO_1, isco_1, Isco_1)
    const taxonomyColumns = headers.filter(h => {
      const upperH = h.toUpperCase()
      const upperKey = taxonomyKey.toUpperCase()
      const prefix = `${upperKey}_`
      if (upperH.startsWith(prefix)) {
        const levelStr = upperH.substring(prefix.length)
        return /^\d+$/.test(levelStr)
      }
      return false
    })

    // Validate field columns
    if (fieldColumns.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'CSV must contain at least one field_* column',
        errors: [{ row: 0, message: 'CSV must contain at least one field_* column' }]
      }, { status: 400 })
    }

    // Check that field columns match existing sentence fields
    const invalidFieldColumns: string[] = []
    fieldColumns.forEach(col => {
      const fieldName = col.substring(6) // Remove 'field_' prefix
      if (!existingFieldNames.includes(fieldName)) {
        invalidFieldColumns.push(col)
      }
    })

    if (invalidFieldColumns.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Field columns not found in existing sentences: ${invalidFieldColumns.join(', ')}`,
        errors: [{ row: 0, message: `Field columns not found in existing sentences: ${invalidFieldColumns.join(', ')}` }]
      }, { status: 400 })
    }

    // Validate taxonomy columns
    if (taxonomyColumns.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `CSV must contain at least one taxonomy level column (e.g., ${taxonomyKey.toUpperCase()}_1, ${taxonomyKey.toUpperCase()}_2)`,
        errors: [{ row: 0, message: `CSV must contain at least one taxonomy level column (e.g., ${taxonomyKey.toUpperCase()}_1, ${taxonomyKey.toUpperCase()}_2)` }]
      }, { status: 400 })
    }

    // Build set of valid taxonomy codes by level
    const validCodesByLevel = new Map<number, Set<string>>()
    taxonomy.nodes.forEach(node => {
      if (!validCodesByLevel.has(node.level)) {
        validCodesByLevel.set(node.level, new Set())
      }
      validCodesByLevel.get(node.level)!.add(node.code)
    })

    // Validate taxonomy codes in each row
    records.forEach((record, idx) => {
      const rowNum = idx + 2 // +2 because CSV has header and 0-indexed
      
      taxonomyColumns.forEach(col => {
        // Extract level from column name (case-insensitive)
        const upperCol = col.toUpperCase()
        const upperKey = taxonomyKey.toUpperCase()
        const levelStr = upperCol.substring(upperKey.length + 1) // Remove "TAXONOMY_" prefix
        const level = parseInt(levelStr, 10)
        
        if (isNaN(level) || level < 1 || level > taxonomy.maxDepth) {
          validationErrors.push({
            row: rowNum,
            message: `Invalid taxonomy column: ${col} (level must be between 1 and ${taxonomy.maxDepth})`
          })
          return
        }

        const code = record[col] ? String(record[col]).trim() : ''
        if (code && code !== '') {
          const validCodes = validCodesByLevel.get(level)
          if (!validCodes || !validCodes.has(code)) {
            validationErrors.push({
              row: rowNum,
              message: `Invalid taxonomy code "${code}" in column ${col} (level ${level})`
            })
          }
        }
      })
    })

    // Return validation results
    if (validationErrors.length > 0) {
      const errorMessages = validationErrors.map(e => `Row ${e.row}: ${e.message}`).join('\n')
      return NextResponse.json({ 
        ok: false, 
        error: `Validation failed:\n${errorMessages}`,
        errors: validationErrors,
        recordCount: records.length
      }, { status: 400 })
    }

    // All validations passed
    return NextResponse.json({ 
      ok: true, 
      message: `File is valid! Found ${records.length} records.`,
      recordCount: records.length,
      fieldColumns: fieldColumns.map(col => col.substring(6)), // Remove 'field_' prefix
      taxonomyLevels: taxonomyColumns.map(col => parseInt(col.substring(taxonomyKey.length + 1), 10))
    })
  } catch (error: any) {
    console.error('Validation error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'An unexpected error occurred during validation',
      errors: [{ row: 0, message: error.message || 'An unexpected error occurred during validation' }]
    }, { status: 500 })
  }
}

