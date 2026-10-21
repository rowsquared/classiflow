import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AI_SOURCE_SLUG, UNKNOWN_NODE_CODES } from '@/lib/constants'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { createTaxonomyNodes } from '@/lib/taxonomy-nodes'
import { readUpload } from '@/lib/upload'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const { key } = await params
    const formData = await req.formData()
    
    const description = formData.get('description') as string | null
    const levelNamesStr = formData.get('levelNames') as string | null
    const file = formData.get('file')

    // Check if taxonomy exists
    const existingTaxonomy = await prisma.taxonomy.findUnique({
      where: { key }
    })

    if (!existingTaxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy not found' 
      }, { status: 404 })
    }

    // Parse level names if provided
    let levelNames = undefined
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

    // Prepare update data
    const updateData: Prisma.TaxonomyUpdateInput = {}
    if (description !== null) updateData.description = description || null
    if (levelNames !== undefined) updateData.levelNames = levelNames

    // Track nodes imported for response
    let nodesImported = 0

    // Handle CSV file update (REPLACE mode): every node is replaced by the file.
    if (file) {
      const upload = await readUpload(file)
      if (!upload.ok) {
        return NextResponse.json({ ok: false, error: upload.error }, { status: 400 })
      }
      const { nodes: parsedNodes, errors: validationErrors } = parseTaxonomyCsv(upload.text)
      if (validationErrors.length > 0) {
        return NextResponse.json({
          ok: false,
          error: formatCsvErrors(validationErrors),
          errors: validationErrors
        }, { status: 400 })
      }

      // Human labels and AI suggestions whose code is not in the new file would
      // silently point at nothing. Report them and require explicit confirmation.
      const newCodes = parsedNodes.map(n => n.code)
      const orphanFilter = {
        taxonomyId: existingTaxonomy.id,
        nodeCode: { notIn: [...newCodes, ...Object.values(UNKNOWN_NODE_CODES)] }
      }
      const [orphanedLabels, orphanedSuggestions] = await prisma.$transaction([
        prisma.sentenceAnnotation.count({ where: { ...orphanFilter, source: 'user' } }),
        prisma.sentenceAISuggestion.count({ where: orphanFilter })
      ])
      if ((orphanedLabels > 0 || orphanedSuggestions > 0) && formData.get('confirmOrphans') !== 'true') {
        const missingCodes = await prisma.sentenceAnnotation.findMany({
          where: { ...orphanFilter, source: 'user' },
          select: { nodeCode: true },
          distinct: ['nodeCode'],
          take: 20
        })
        return NextResponse.json({
          ok: false,
          code: 'ORPHANED_LABELS',
          orphanedLabels,
          orphanedSuggestions,
          error: `The new file drops codes that ${orphanedLabels} human label(s) and ${orphanedSuggestions} AI suggestion(s) still use` +
            (missingCodes.length ? ` (e.g. ${missingCodes.map(c => c.nodeCode).join(', ')})` : '') +
            '. Those labels would point at codes that no longer exist.'
        }, { status: 409 })
      }

      const fileDepth = Math.max(...parsedNodes.map(n => n.level))
      await prisma.$transaction(async (tx) => {
        await tx.taxonomySynonym.deleteMany({
          where: { taxonomyId: existingTaxonomy.id }
        })
        await tx.taxonomyNode.deleteMany({
          where: { taxonomyId: existingTaxonomy.id }
        })
        await createTaxonomyNodes(tx, existingTaxonomy.id, parsedNodes)
      }, { timeout: 120_000 })

      // The depth follows the file, so label validation accepts its deepest level.
      updateData.maxDepth = fileDepth
      nodesImported = parsedNodes.length
    }

    // Update taxonomy metadata
    const updatedTaxonomy = await prisma.taxonomy.update({
      where: { key },
      data: updateData
    })

    return NextResponse.json({ 
      ok: true, 
      taxonomy: updatedTaxonomy,
      nodesReplaced: nodesImported
    })

  } catch (caught) {

    const error = caught as CaughtError
    console.error('Update taxonomy error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || String(error) 
    }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const { key } = await params

    const existingTaxonomy = await prisma.taxonomy.findUnique({
      where: { key },
      select: {
        id: true,
        key: true,
        _count: {
          select: {
            nodes: true,
            annotations: true,
            aiSuggestions: true,
            synonyms: true
          }
        }
      }
    })

    if (!existingTaxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy not found' 
      }, { status: 404 })
    }

    const taxonomyId = existingTaxonomy.id
    const taxonomyKey = existingTaxonomy.key

    // Deleting under a running AI job would let its monitor write results for a
    // taxonomy that no longer exists. Cancel or wait for those jobs first.
    const activeJobs = await prisma.$transaction([
      prisma.aILabelingJob.count({ where: { taxonomyId, status: { in: ['pending', 'processing'] } } }),
      prisma.aILearningJob.count({ where: { taxonomyId, status: { in: ['pending', 'processing'] } } }),
    ])
    if (activeJobs[0] + activeJobs[1] > 0) {
      return NextResponse.json({
        ok: false,
        error: 'This taxonomy has running AI jobs. Cancel them or wait until they finish, then delete it.'
      }, { status: 409 })
    }

    // Hard delete: local data first, in one transaction. The AI service is only
    // told afterwards, so a failed local delete never leaves it out of step.
    const deletionResult = await prisma.$transaction(async (tx) => {
      const deletedAISuggestions = await tx.sentenceAISuggestion.deleteMany({
        where: { taxonomyId }
      })

      // Annotations (submitted labels) for this taxonomy
      const deletedAnnotations = await tx.sentenceAnnotation.deleteMany({
        where: { taxonomyId }
      })

      // Synonyms reference nodes, so they go first
      const deletedSynonyms = await tx.taxonomySynonym.deleteMany({
        where: { taxonomyId }
      })

      const deletedNodes = await tx.taxonomyNode.deleteMany({
        where: { taxonomyId }
      })

      await tx.taxonomySetting.deleteMany({
        where: { taxonomyId }
      })

      // Finished AI job history for this taxonomy (every job table references it)
      await tx.aILabelingJob.deleteMany({ where: { taxonomyId } })
      await tx.aILearningJob.deleteMany({ where: { taxonomyId } })
      await tx.aIExternalTrainingJob.deleteMany({ where: { taxonomyId } })

      await tx.taxonomy.delete({
        where: { id: taxonomyId }
      })

      return {
        deletedNodes: deletedNodes.count,
        deletedAnnotations: deletedAnnotations.count,
        deletedAISuggestions: deletedAISuggestions.count,
        deletedSynonyms: deletedSynonyms.count
      }
    })

    // Tell the AI service, if one is configured. Failure is reported, not fatal:
    // the taxonomy is already gone here.
    let aiNotified = false
    if (process.env.AI_LABELING_API_URL) {
      try {
        const { startAIJob } = await import('@/lib/ai-labeling')
        await startAIJob('/taxonomies', {
          action: 'delete',
          ...(AI_SOURCE_SLUG ? { sourceSlug: AI_SOURCE_SLUG } : {}),
          taxonomy: {
            key: taxonomyKey
          }
        })
        aiNotified = true
      } catch (syncError) {
        console.error('Taxonomy deleted, but notifying the AI service failed:', syncError)
      }
    }

    return NextResponse.json({ 
      ok: true, 
      message: 'Taxonomy and all associated data deleted successfully',
      aiNotified,
      deleted: {
        nodes: deletionResult.deletedNodes,
        annotations: deletionResult.deletedAnnotations,
        aiSuggestions: deletionResult.deletedAISuggestions,
        synonyms: deletionResult.deletedSynonyms
      }
    })

  } catch (caught) {

    const error = caught as CaughtError
    console.error('Delete taxonomy error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || String(error) 
    }, { status: 500 })
  }
}


