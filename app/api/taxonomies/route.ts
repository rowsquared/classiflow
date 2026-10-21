import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parse } from 'csv-parse/sync'
import { isUnknownNodeCode } from '@/lib/constants'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError, CsvRow } from '@/lib/utils'
import { Prisma } from '@prisma/client'

const MAX_ACTIVE_TAXONOMIES = 3

export async function GET() {
  const { error } = await requireSession()
  if (error) return error

  try {
    // No longer filtering by isActive since we're using hard delete
    // Keep the parameter for backward compatibility but ignore it
    const taxonomies = await prisma.taxonomy.findMany({
      where: {},
      include: {
        _count: {
          select: { 
            nodes: true,
            annotations: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' }
      ]
    })

    // Add computed statistics
    const taxonomiesWithStats = await Promise.all(
      taxonomies.map(async (taxonomy) => {
        // Get actual max level from nodes
        const maxLevelNode = await prisma.taxonomyNode.findFirst({
          where: { taxonomyId: taxonomy.id },
          orderBy: { level: 'desc' },
          select: { level: true }
        })

        // Get node count per level
        const nodeCounts = await prisma.taxonomyNode.groupBy({
          by: ['level'],
          where: { taxonomyId: taxonomy.id },
          _count: true,
          orderBy: { level: 'asc' }
        })

        const levelCounts = nodeCounts.map(lc => ({
          level: lc.level,
          count: lc._count,
          name: taxonomy.levelNames 
            ? (taxonomy.levelNames as Record<string, string>)[lc.level.toString()] || `Level ${lc.level}`
            : `Level ${lc.level}`
        }))

        // Get last external training date
        const lastExternalTraining = await prisma.aIExternalTrainingJob.findFirst({
          where: {
            taxonomyId: taxonomy.id,
            status: 'completed'
          },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true }
        })
        const lastExternalTrainingAt = lastExternalTraining?.completedAt?.toISOString() ?? null

        return {
          ...taxonomy,
          nodeCount: taxonomy._count.nodes,
          annotationCount: taxonomy._count.annotations,
          actualMaxLevel: maxLevelNode?.level || 0,
          levelCounts,
          lastExternalTrainingAt,
          _count: undefined
        }
      })
    )

    const learningThreshold = parseInt(process.env.AI_LEARNING_MIN_NEW_ANNOTATIONS || '500', 10)

    return NextResponse.json({ 
      ok: true, 
      learningThreshold,
      taxonomies: taxonomiesWithStats 
    })
  } catch (error) {
    console.error('Taxonomies API error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: String(error) 
    }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const formData = await req.formData()
    
    const key = formData.get('key') as string
    const description = formData.get('description') as string | null
    const maxDepth = parseInt(formData.get('maxDepth') as string)
    const levelNamesStr = formData.get('levelNames') as string | null
    const file = formData.get('file') as File

    // Validation
    if (!key || !maxDepth || !file) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required fields: key, maxDepth, file' 
      }, { status: 400 })
    }

    // Check active taxonomy limit (all taxonomies are active now since we use hard delete)
    const activeTaxonomiesCount = await prisma.taxonomy.count()

    if (activeTaxonomiesCount >= MAX_ACTIVE_TAXONOMIES) {
      return NextResponse.json({ 
        ok: false, 
        error: `Maximum ${MAX_ACTIVE_TAXONOMIES} active taxonomies allowed. Please delete one before adding a new one.` 
      }, { status: 400 })
    }

    // Check key uniqueness
    const existingTaxonomy = await prisma.taxonomy.findUnique({
      where: { key }
    })

    if (existingTaxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: `Taxonomy with key "${key}" already exists` 
      }, { status: 400 })
    }

    // Parse level names if provided
    let levelNames = null
    if (levelNamesStr) {
      try {
        levelNames = JSON.parse(levelNamesStr)
      } catch {
        return NextResponse.json({ 
          ok: false, 
          error: 'Invalid levelNames JSON' 
        }, { status: 400 })
      }
    }

    // Parse CSV
    const buffer = Buffer.from(await file.arrayBuffer())
    const csv = buffer.toString('utf-8')
    // Use cast: false to preserve leading zeros in id and parent_id columns
    const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, cast: false }) as CsvRow[]

    if (records.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'CSV file is empty' 
      }, { status: 400 })
    }

    // Validate CSV headers
    if (!records || records.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'CSV file is empty or contains no data rows' 
      }, { status: 400 })
    }

    const headers = Object.keys(records[0] || {})
    const requiredHeaders = ['id', 'label', 'parent_id', 'level']
    const allowedOptionalHeaders = ['definition', 'examples', 'synonyms']
    const allAllowedHeaders = [...requiredHeaders, ...allowedOptionalHeaders]
    
    // Check for missing required columns
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
    if (missingHeaders.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Missing required columns: ${missingHeaders.join(', ')}. The CSV must contain: id, label, parent_id, and level.` 
      }, { status: 400 })
    }
    
    // Check for disallowed columns
    const disallowedHeaders = headers.filter(h => !allAllowedHeaders.includes(h))
    if (disallowedHeaders.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Disallowed columns found: ${disallowedHeaders.join(', ')}. Only the following columns are allowed: ${allAllowedHeaders.join(', ')}.` 
      }, { status: 400 })
    }

    // Validate data: check for duplicate ids and invalid parent_ids
    const validationErrors: Array<{ row: number; message: string }> = []
    const idRowMap = new Map<string, number[]>() // Track all row numbers for each id (preserve leading zeros)
    const allIds = new Set<string>() // All id values for parent_id validation
    
    // First pass: collect all ids and check for duplicates
    records.forEach((record, idx) => {
      const rowNum = idx + 2 // +2 because CSV has header and 0-indexed
      const id = String(record.id).trim()
      
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
      const parentId = record.parent_id ? String(record.parent_id).trim() : ''
      
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
    
    // Return all validation errors if any found
    if (validationErrors.length > 0) {
      const errorMessages = validationErrors.map(e => `Row ${e.row}: ${e.message}`).join('\n')
      return NextResponse.json({ 
        ok: false, 
        error: `Validation failed:\n${errorMessages}`,
        errors: validationErrors
      }, { status: 400 })
    }

    // All validation passed, use records as-is (validation ensures data integrity)
    const finalRecords = records

    // Create taxonomy and import nodes in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create taxonomy
      const taxonomy = await tx.taxonomy.create({
        data: {
          key,
          description: description || null,
          maxDepth,
          levelNames: levelNames || undefined
        }
      })

      // Create nodes
      const nodes = finalRecords.map((record) => {
        const code = String(record.id).trim()
        const parentCode = record.parent_id && String(record.parent_id).trim()
          ? String(record.parent_id).trim()
          : null

        return {
          taxonomyId: taxonomy.id,
          code,
          level: parseInt(String(record.level).trim()),
          label: String(record.label || '').trim(),
          definition: String(record.definition || '').trim() || null,
          examples: String(record.examples || '').trim() || null,
          parentCode
        }
      })

      await tx.taxonomyNode.createMany({ data: nodes })

      // Create synonyms, linked by node id (the node ids only exist after createMany)
      const createdNodes = await tx.taxonomyNode.findMany({
        where: { taxonomyId: taxonomy.id },
        select: { id: true, code: true }
      })
      const nodeIdByCode = new Map(createdNodes.map(n => [n.code, n.id]))
      const synonymsToCreate: Prisma.TaxonomySynonymCreateManyInput[] = []
      finalRecords.forEach((record) => {
        const synonymsStr = String(record.synonyms || '').trim()
        if (synonymsStr) {
          const synonymsList = synonymsStr.split(',').map(s => s.trim()).filter(s => s)
          const nodeId = nodeIdByCode.get(String(record.id).trim())
          if (!nodeId) return
          synonymsList.forEach(synonym => {
            synonymsToCreate.push({
              taxonomyId: taxonomy.id,
              nodeId,
              synonym
            })
          })
        }
      })

      if (synonymsToCreate.length > 0) {
        await tx.taxonomySynonym.createMany({ data: synonymsToCreate })
      }

      return taxonomy
    })

    return NextResponse.json({ 
      ok: true, 
      taxonomy: result,
      importedNodes: finalRecords.length
    })

  } catch (caught) {

    const error = caught as CaughtError
    console.error('Create taxonomy error:', error)
    
    // Extract clean error message
    let errorMessage = error?.message || String(error)
    
    // Truncate extremely long error messages (e.g., Prisma validation errors with full data)
    if (errorMessage.length > 1000) {
      // Find the actual error message in the multi-line output
      const lines = errorMessage.split('\n')
      
      // Look for the "Argument ... is missing" or similar error
      const errorLine = lines.find((line: string) => 
        line.trim().startsWith('Argument') || 
        line.includes('is missing') ||
        line.includes('is required')
      )
      
      if (errorLine) {
        // Get the line before "Argument" which usually has "Invalid ..." 
        const errorIndex = lines.indexOf(errorLine)
        const contextLine = errorIndex > 0 ? lines[errorIndex - 1] : ''
        
        if (contextLine && contextLine.includes('Invalid')) {
          errorMessage = `${contextLine.trim()} ${errorLine.trim()}`
        } else {
          errorMessage = errorLine.trim()
        }
      } else {
        // Fallback: just get first 500 chars
        errorMessage = errorMessage.substring(0, 500) + '...'
      }
    }
    
    return NextResponse.json({ 
      ok: false, 
      error: errorMessage
    }, { status: 500 })
  }
}

