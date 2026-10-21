import { NextRequest, NextResponse } from 'next/server'
import { parse } from 'csv-parse/sync'
import { isUnknownNodeCode } from '@/lib/constants'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError, CsvRow } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ 
        ok: false, 
        error: 'No file provided',
        errors: [{ row: 0, message: 'No file provided' }]
      }, { status: 400 })
    }

    // Parse CSV
    const buffer = Buffer.from(await file.arrayBuffer())
    const csv = buffer.toString('utf-8')
    
    let records: CsvRow[]
    try {
      // Parse without casting to preserve leading zeros in id and parent_id
      records = parse(csv, { 
        columns: true, 
        skip_empty_lines: true, 
        bom: true,
        cast: false, // Don't auto-cast to preserve string format (especially leading zeros)
        skip_records_with_error: false
      }) as CsvRow[]
    } catch (caught) {
      const parseError = caught as CaughtError
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
    const requiredHeaders = ['id', 'label', 'parent_id', 'level']
    const allowedOptionalHeaders = ['definition', 'examples', 'synonyms']
    const allAllowedHeaders = [...requiredHeaders, ...allowedOptionalHeaders]
    
    const validationErrors: Array<{ row: number; message: string }> = []
    
    // Check for missing required columns
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
    if (missingHeaders.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Missing required columns: ${missingHeaders.join(', ')}. The CSV must contain: id, label, parent_id, and level.`,
        errors: [{ row: 0, message: `Missing required columns: ${missingHeaders.join(', ')}` }]
      }, { status: 400 })
    }
    
    // Check for disallowed columns
    const disallowedHeaders = headers.filter(h => !allAllowedHeaders.includes(h))
    if (disallowedHeaders.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Disallowed columns found: ${disallowedHeaders.join(', ')}. Only the following columns are allowed: ${allAllowedHeaders.join(', ')}.`,
        errors: [{ row: 0, message: `Disallowed columns: ${disallowedHeaders.join(', ')}` }]
      }, { status: 400 })
    }

    // Validate data: check for duplicate ids and invalid parent_ids
    const idRowMap = new Map<string, number[]>() // Track all row numbers for each id (preserve leading zeros)
    const allIds = new Set<string>() // All id values for parent_id validation
    
    // First pass: collect all ids and check for duplicates
    records.forEach((record, idx) => {
      const rowNum = idx + 2 // +2 because CSV has header and 0-indexed
      // Preserve original string format, including leading zeros
      // Convert to string but preserve the exact format from CSV
      const idRaw = record.id
      const id = idRaw != null ? String(idRaw).trim() : ''
      
      if (!id) {
        validationErrors.push({
          row: rowNum,
          message: 'Empty id value'
        })
        return
      }
      
      // Validate that id is not -99 (reserved for UNKNOWN)
      if (isUnknownNodeCode(id)) {
        validationErrors.push({
          row: rowNum,
          message: 'Code -99 is reserved for UNKNOWN labels and cannot be used'
        })
        return
      }
      
      // Track id occurrences for duplicate detection (preserve leading zeros with string comparison)
      if (idRowMap.has(id)) {
        idRowMap.get(id)!.push(rowNum)
      } else {
        idRowMap.set(id, [rowNum])
        allIds.add(id)
      }
    })
    
    // Report duplicate ids
    for (const [id, rowNumbers] of idRowMap.entries()) {
      if (rowNumbers.length > 1) {
        const rowsList = rowNumbers.join(', ')
        validationErrors.push({
          row: rowNumbers[0],
          message: `Duplicate id "${id}" found in rows: ${rowsList}`
        })
        // Also add errors for subsequent occurrences
        for (let i = 1; i < rowNumbers.length; i++) {
          validationErrors.push({
            row: rowNumbers[i],
            message: `Duplicate id "${id}" (also appears in row ${rowNumbers[0]})`
          })
        }
      }
    }
    
    // Second pass: validate parent_id values exist in id column
    records.forEach((record, idx) => {
      const rowNum = idx + 2
      // Preserve original string format, including leading zeros
      const parentIdRaw = record.parent_id
      const parentId = parentIdRaw != null ? String(parentIdRaw).trim() : ''
      
      // Validate that parent_id is not -99 (reserved for UNKNOWN)
      if (parentId && isUnknownNodeCode(parentId)) {
        validationErrors.push({
          row: rowNum,
          message: 'Code -99 is reserved for UNKNOWN labels and cannot be used as parent_id'
        })
        return
      }
      
      // Check if parent_id exists in id column (only if parent_id is provided and not empty)
      if (parentId && !allIds.has(parentId)) {
        validationErrors.push({
          row: rowNum,
          message: `parent_id "${parentId}" does not match any id value in the file`
        })
      }
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
      recordCount: records.length
    })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Validation error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'An unexpected error occurred during validation',
      errors: [{ row: 0, message: error.message || 'An unexpected error occurred during validation' }]
    }, { status: 500 })
  }
}

