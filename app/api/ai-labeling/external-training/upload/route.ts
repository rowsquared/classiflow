import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parse } from 'csv-parse/sync'
import { promises as fs } from 'fs'
import path from 'path'
import { buildFieldMap } from '@/lib/ai-utils'

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
        error: 'No file provided'
      }, { status: 400 })
    }

    if (!taxonomyKey) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy key is required'
      }, { status: 400 })
    }

    // Get taxonomy
    const taxonomy = await prisma.taxonomy.findUnique({
      where: { key: taxonomyKey, isActive: true }
    })

    if (!taxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy not found'
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
        error: `CSV parsing error: ${parseError.message}`
      }, { status: 400 })
    }

    if (!records || records.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'CSV file is empty'
      }, { status: 400 })
    }

    const headers = Object.keys(records[0] || {})
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

    // Validate field columns exist
    const invalidFieldColumns = fieldColumns.filter(col => {
      const fieldName = col.substring(6)
      return !existingFieldNames.includes(fieldName)
    })

    if (invalidFieldColumns.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Field columns not found: ${invalidFieldColumns.join(', ')}`
      }, { status: 400 })
    }

    // Convert records to training data format
    const trainingData = records.map(record => {
      // Build fields object
      const fields: Record<string, string> = {}
      fieldColumns.forEach(col => {
        const fieldName = col.substring(6) // Remove 'field_' prefix
        const value = record[col]
        if (value != null && String(value).trim() !== '') {
          fields[fieldName] = String(value).trim()
        }
      })

      // Build annotations array from taxonomy columns
      const annotations: Array<{ level: number; nodeCode: string }> = []
      taxonomyColumns.forEach(col => {
        // Extract level from column name (case-insensitive)
        const upperCol = col.toUpperCase()
        const upperKey = taxonomyKey.toUpperCase()
        const levelStr = upperCol.substring(upperKey.length + 1) // Remove "TAXONOMY_" prefix
        const level = parseInt(levelStr, 10)
        const code = record[col] ? String(record[col]).trim() : ''
        
        if (code && code !== '') {
          annotations.push({
            level,
            nodeCode: code
          })
        }
      })

      // Sort annotations by level
      annotations.sort((a, b) => a.level - b.level)

      return {
        fields,
        annotations,
        source: 'external' as const
      }
    })

    // Generate unique job ID for file naming
    const jobId = `training-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    const fileName = `${jobId}.json`
    
    // Ensure training-data directory exists
    const trainingDataDir = path.join(process.cwd(), 'public', 'training-data')
    try {
      await fs.mkdir(trainingDataDir, { recursive: true })
    } catch (error) {
      // Directory might already exist, that's fine
    }

    // Write JSON file
    const filePath = path.join(trainingDataDir, fileName)
    await fs.writeFile(filePath, JSON.stringify(trainingData, null, 2), 'utf-8')

    // Return the public URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const publicUrl = `${baseUrl}/training-data/${fileName}`

    return NextResponse.json({ 
      ok: true, 
      jobId,
      fileName: file.name,
      recordCount: trainingData.length,
      trainingDataUrl: publicUrl
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'An unexpected error occurred during upload'
    }, { status: 500 })
  }
}

