import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { createTaxonomyNodes } from '@/lib/taxonomy-nodes'
import { readUpload } from '@/lib/upload'

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
    return NextResponse.json({ ok: false, error: 'Failed to load taxonomies' }, { status: 500 })
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
    const file = formData.get('file')

    // Validation
    if (!key || !maxDepth || !file) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required fields: key, maxDepth, file'
      }, { status: 400 })
    }
    // Keys become URL segments, export column prefixes and AI service identifiers.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(key)) {
      return NextResponse.json({
        ok: false,
        error: 'Key must be 1-50 letters, digits, "_" or "-", starting with a letter or digit'
      }, { status: 400 })
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 5) {
      return NextResponse.json({ ok: false, error: 'maxDepth must be between 1 and 5' }, { status: 400 })
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

    const upload = await readUpload(file)
    if (!upload.ok) {
      return NextResponse.json({ ok: false, error: upload.error }, { status: 400 })
    }
    const { nodes: parsedNodes, errors: validationErrors } = parseTaxonomyCsv(upload.text, { maxDepth })
    if (validationErrors.length > 0) {
      return NextResponse.json({
        ok: false,
        error: formatCsvErrors(validationErrors),
        errors: validationErrors
      }, { status: 400 })
    }

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

      await createTaxonomyNodes(tx, taxonomy.id, parsedNodes)

      return taxonomy
    })

    return NextResponse.json({ 
      ok: true, 
      taxonomy: result,
      importedNodes: parsedNodes.length
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

