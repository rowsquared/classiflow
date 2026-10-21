import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { isUnknownNodeCode } from '@/lib/constants'
import { Prisma, SentenceStatus } from '@prisma/client'
import { toCsv, type CsvColumn } from '@/lib/csv'

/**
 * GET /api/export?status=...&dateRange=...&formulaSafe=false
 *
 * Exports labeled sentences with annotations. Free-text cells that would run as
 * spreadsheet formulas get a leading apostrophe unless formulaSafe=false
 * (lib/csv.ts); ids and codes are never changed.
 * Handles unknown codes (-9, -99, ...) as UNKNOWN in the export
 */
export async function GET(req: NextRequest) {
  try {
    // Only admins can export
    const { error: authError } = await requireSession('admin')
    if (authError) return authError

    const searchParams = req.nextUrl.searchParams
    const statusFilter = searchParams.get('status') || 'all'
    const dateRange = searchParams.get('dateRange') || 'all'
    const neutralizeFormulas = searchParams.get('formulaSafe') !== 'false'

    // Build where clause
    const where: Prisma.SentenceWhereInput = {}

    if (statusFilter !== 'all') {
      if (!(Object.values(SentenceStatus) as string[]).includes(statusFilter)) {
        return NextResponse.json({ error: `Unknown status "${statusFilter}"` }, { status: 400 })
      }
      where.status = statusFilter as SentenceStatus
    }

    if (dateRange !== 'all') {
      const end = new Date()
      const start = new Date()

      switch (dateRange) {
        case 'today':
          start.setHours(0, 0, 0, 0)
          break
        case 'week':
          start.setDate(start.getDate() - 7)
          break
        case 'month':
          start.setDate(start.getDate() - 30)
          break
      }

      where.lastEditedAt = {
        gte: start,
        lte: end
      }
    }

    // Fetch sentences with annotations, AI suggestions, and related data
    const sentences = await prisma.sentence.findMany({
      where,
      include: {
        annotations: {
          include: {
            taxonomy: {
              select: {
                key: true,
                maxDepth: true
              }
            }
          }
        },
        aiSuggestions: {
          include: {
            taxonomy: {
              select: {
                key: true,
                maxDepth: true
              }
            }
          },
          orderBy: [
            { taxonomyId: 'asc' },
            { level: 'asc' }
          ]
        },
        comments: {
          select: {
            body: true,
            createdAt: true,
            author: {
              select: { name: true }
            }
          }
        },
        lastEditor: {
          select: { name: true }
        }
      },
      orderBy: [
        { importId: 'asc' },
        { importOrder: 'asc' }
      ]
    })

    // Group taxonomies to determine max depth for each (from both annotations and AI suggestions)
    const taxonomies: Record<string, number> = {}
    for (const sentence of sentences) {
      for (const ann of sentence.annotations) {
        if (!taxonomies[ann.taxonomy.key]) {
          taxonomies[ann.taxonomy.key] = ann.taxonomy.maxDepth || 5
        }
      }
      for (const aiSuggestion of sentence.aiSuggestions) {
        if (!taxonomies[aiSuggestion.taxonomy.key]) {
          taxonomies[aiSuggestion.taxonomy.key] = aiSuggestion.taxonomy.maxDepth || 5
        }
      }
    }

    // Build CSV header
    const headers: string[] = ['id']
    
    // Collect all unique field and support column names across all sentences
    const allFieldColumns = new Set<string>()
    const allSupportColumns = new Set<string>()
    const fieldColumnOrder: string[] = []
    const supportColumnOrder: string[] = []
    
    // Determine which columns exist and their order
    for (const sentence of sentences) {
      const fieldMapping = sentence.fieldMapping as Record<string, string>
      const supportMapping = (sentence.supportMapping as Record<string, string>) || {}
      
      // Field columns (1-5) - use format field_FIELD_NAME
      // fieldMapping uses numeric keys: { "1": "job_description", "2": "job_title", ... }
      for (let i = 1; i <= 5; i++) {
        const fieldKey = `field${i}`
        const fieldValue = sentence[fieldKey as keyof typeof sentence]
        if (fieldValue) {
          // fieldMapping keys are "1", "2", etc., not "field1", "field2"
          const originalColumnName = fieldMapping[String(i)] || fieldKey
          const columnName = `field_${originalColumnName}`
          if (!allFieldColumns.has(columnName)) {
            allFieldColumns.add(columnName)
            fieldColumnOrder.push(columnName)
          }
        }
      }
      
      // Support columns (1-5) - use format support_FIELD_NAME
      // supportMapping uses numeric keys: { "1": "interviewer", "2": "industry", ... }
      for (let i = 1; i <= 5; i++) {
        const supportKey = `support${i}`
        const supportValue = sentence[supportKey as keyof typeof sentence]
        if (supportValue) {
          // supportMapping keys are "1", "2", etc., not "support1", "support2"
          const originalColumnName = supportMapping[String(i)] || supportKey
          const columnName = `support_${originalColumnName}`
          if (!allSupportColumns.has(columnName)) {
            allSupportColumns.add(columnName)
            supportColumnOrder.push(columnName)
          }
        }
      }
    }
    
    // Original field/support columns hold free text; everything else is ids, codes, numbers and states.
    const textHeaders = new Set<string>([...fieldColumnOrder, ...supportColumnOrder, 'last_editor', 'comments'])

    // Add field columns to headers
    headers.push(...fieldColumnOrder)
    // Add support columns to headers
    headers.push(...supportColumnOrder)

    // Add annotation columns for each taxonomy (one column per level) - format: {taxonomyKey}_{level}
    for (const [taxonomyKey, maxDepth] of Object.entries(taxonomies)) {
      for (let level = 1; level <= maxDepth; level++) {
        headers.push(`${taxonomyKey}_${level}`)
      }
    }

    // Add AI suggestion columns for each taxonomy - format: {taxonomyKey}_ai{level} and {taxonomyKey}_ai{level}c
    for (const [taxonomyKey, maxDepth] of Object.entries(taxonomies)) {
      for (let level = 1; level <= maxDepth; level++) {
        headers.push(`${taxonomyKey}_ai${level}`, `${taxonomyKey}_ai${level}c`)
      }
    }

    // Add metadata columns
    headers.push('status', 'flagged', 'last_editor', 'last_edited', 'comments')

    // Build CSV rows
    const rows: string[][] = []

    for (const sentence of sentences) {
      const row: string[] = [sentence.id]

      const fieldMapping = sentence.fieldMapping as Record<string, string>
      const supportMapping = (sentence.supportMapping as Record<string, string>) || {}

      // Add field values - use field_FIELD_NAME format
      for (const columnName of fieldColumnOrder) {
        // Extract the original field name from field_FIELD_NAME
        const originalFieldName = columnName.replace(/^field_/, '')
        // Find which field number this corresponds to
        // fieldMapping uses numeric keys: { "1": "job_description", "2": "job_title", ... }
        let found = false
        for (let i = 1; i <= 5; i++) {
          // Check if this field number maps to the original field name
          if (fieldMapping[String(i)] === originalFieldName) {
            const fieldKey = `field${i}` as keyof typeof sentence
            const value = sentence[fieldKey]
            row.push(value ? String(value) : '')
            found = true
            break
          }
        }
        if (!found) {
          row.push('')
        }
      }

      // Add support values - use support_FIELD_NAME format
      // supportMapping uses numeric keys: { "1": "interviewer", "2": "industry", ... }
      for (const columnName of supportColumnOrder) {
        // Extract the original field name from support_FIELD_NAME
        const originalFieldName = columnName.replace(/^support_/, '')
        // Find which support number this corresponds to
        let found = false
        for (let i = 1; i <= 5; i++) {
          // Check if this support number maps to the original field name
          if (supportMapping[String(i)] === originalFieldName) {
            const supportKey = `support${i}` as keyof typeof sentence
            const value = sentence[supportKey]
            row.push(value ? String(value) : '')
            found = true
            break
          }
        }
        if (!found) {
          row.push('')
        }
      }

      // Add annotations (grouped by taxonomy and level) - format: {taxonomyKey}_{level}
      // Only include user annotations (actual labels)
      for (const [taxonomyKey, maxDepth] of Object.entries(taxonomies)) {
        for (let level = 1; level <= maxDepth; level++) {
          const annotation = sentence.annotations.find(
            a => a.taxonomy.key === taxonomyKey && a.level === level && a.source === 'user'
          )
          
          if (annotation) {
            // Handle '-99' as UNKNOWN
            const code = isUnknownNodeCode(annotation.nodeCode) ? 'UNKNOWN' : String(annotation.nodeCode)
            row.push(code)
          } else {
            row.push('') // No user annotation for this level
          }
        }
      }

      // Add AI suggestions - format: {taxonomyKey}_ai{level} and {taxonomyKey}_ai{level}c
      for (const [taxonomyKey, maxDepth] of Object.entries(taxonomies)) {
        for (let level = 1; level <= maxDepth; level++) {
          const aiSuggestion = sentence.aiSuggestions.find(
            s => s.taxonomy.key === taxonomyKey && s.level === level
          )
          
          if (aiSuggestion) {
            const code = isUnknownNodeCode(aiSuggestion.nodeCode) ? 'UNKNOWN' : String(aiSuggestion.nodeCode)
            const confidence = aiSuggestion.confidenceScore.toFixed(4)
            row.push(code, confidence)
          } else {
            row.push('', '') // No AI suggestion for this level
          }
        }
      }

      // Add metadata
      row.push(sentence.status)
      row.push(sentence.flagged ? 'true' : 'false')
      row.push(sentence.lastEditor?.name || '')
      row.push(sentence.lastEditedAt ? new Date(sentence.lastEditedAt).toISOString() : '')
      
      // Add comments (concatenated)
      const commentText = sentence.comments.map(c => 
        `[${c.author.name || 'Unknown'}]: ${c.body}`
      ).join(' | ')
      row.push(commentText)

      rows.push(row)
    }

    const columns: CsvColumn[] = headers.map(header => ({ header, text: textHeaders.has(header) }))
    const csv = toCsv(columns, rows, { neutralizeFormulas })

    // Return as downloadable CSV
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="export-${new Date().toISOString()}.csv"`
      }
    })

  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

