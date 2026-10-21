import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace, scopeWorkspaceId } from '@/lib/workspace/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { UNKNOWN_NODE_CODES } from '@/lib/constants'
import { workspaceRoute } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { createTaxonomyNodes } from '@/lib/taxonomy-nodes'
import { readUpload } from '@/lib/upload'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/logger'

export const PUT = workspaceRoute<'key'>(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const { key } = routeParams
    const formData = await req.formData()

    const description = formData.get('description') as string | null
    const levelNamesStr = formData.get('levelNames') as string | null
    const file = formData.get('file')

    // Check if taxonomy exists
    const existingTaxonomy = await db().taxonomy.findUnique({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } }
    })

    if (!existingTaxonomy) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Taxonomy not found'
        },
        { status: 404 }
      )
    }

    // Parse level names if provided
    let levelNames = undefined
    if (levelNamesStr) {
      try {
        levelNames = JSON.parse(levelNamesStr)
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: 'Invalid levelNames JSON'
          },
          { status: 400 }
        )
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
        return NextResponse.json(
          {
            ok: false,
            error: formatCsvErrors(validationErrors),
            errors: validationErrors
          },
          { status: 400 }
        )
      }

      // Human labels and AI suggestions whose code is not in the new file would
      // silently point at nothing. Report them and require explicit confirmation.
      const newCodes = parsedNodes.map(n => n.code)
      const orphanFilter = {
        taxonomyId: existingTaxonomy.id,
        nodeCode: { notIn: [...newCodes, ...Object.values(UNKNOWN_NODE_CODES)] }
      }
      const [orphanedLabels, orphanedSuggestions] = await Promise.all([
        db().sentenceAnnotation.count({ where: { ...orphanFilter, source: 'user' } }),
        db().sentenceAISuggestion.count({ where: orphanFilter })
      ])
      if ((orphanedLabels > 0 || orphanedSuggestions > 0) && formData.get('confirmOrphans') !== 'true') {
        const missingCodes = await db().sentenceAnnotation.findMany({
          where: { ...orphanFilter, source: 'user' },
          select: { nodeCode: true },
          distinct: ['nodeCode'],
          take: 20
        })
        return NextResponse.json(
          {
            ok: false,
            code: 'ORPHANED_LABELS',
            orphanedLabels,
            orphanedSuggestions,
            error:
              `The new file drops codes that ${orphanedLabels} human label(s) and ${orphanedSuggestions} AI suggestion(s) still use` +
              (missingCodes.length ? ` (e.g. ${missingCodes.map(c => c.nodeCode).join(', ')})` : '') +
              '. Those labels would point at codes that no longer exist.'
          },
          { status: 409 }
        )
      }

      const fileDepth = Math.max(...parsedNodes.map(n => n.level))
      await inCurrentWorkspace(async () => {
        const tx = db()
        await tx.taxonomySynonym.deleteMany({
          where: { taxonomyId: existingTaxonomy.id }
        })
        await tx.taxonomyNode.deleteMany({
          where: { taxonomyId: existingTaxonomy.id }
        })
        await createTaxonomyNodes(tx, scopeWorkspaceId(), existingTaxonomy.id, parsedNodes)
      })

      // The depth follows the file, so label validation accepts its deepest level.
      updateData.maxDepth = fileDepth
      nodesImported = parsedNodes.length
    }

    // Update taxonomy metadata
    const updatedTaxonomy = await db().taxonomy.update({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } },
      data: updateData
    })

    await audit({
      actorId: actor.id,
      action: 'taxonomy.updated',
      entityType: 'taxonomy',
      entityId: updatedTaxonomy.id,
      payload: { key: updatedTaxonomy.key, fields: Object.keys(updateData), nodesReplaced: nodesImported }
    })
    return NextResponse.json({
      ok: true,
      taxonomy: updatedTaxonomy,
      nodesReplaced: nodesImported
    })
  } catch (caught) {
    const error = caught as CaughtError
    await logError('Update taxonomy failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error)
      },
      { status: 500 }
    )
  }
})

export const DELETE = workspaceRoute<'key'>(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const { key } = routeParams

    const existingTaxonomy = await db().taxonomy.findUnique({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } },
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
      return NextResponse.json(
        {
          ok: false,
          error: 'Taxonomy not found'
        },
        { status: 404 }
      )
    }

    const taxonomyId = existingTaxonomy.id
    const taxonomyKey = existingTaxonomy.key

    // Deleting under a running AI job would let its monitor write results for a
    // taxonomy that no longer exists. Cancel or wait for those jobs first.
    const activeJobs = await Promise.all([
      db().aILabelingJob.count({ where: { taxonomyId, status: { in: ['pending', 'processing'] } } }),
      db().aILearningJob.count({ where: { taxonomyId, status: { in: ['pending', 'processing'] } } }),
      db().aITaxonomySyncJob.count({ where: { taxonomyId, status: { in: ['pending', 'processing'] } } })
    ])
    if (activeJobs[0] + activeJobs[1] + activeJobs[2] > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'This taxonomy has running AI jobs. Cancel them or wait until they finish, then delete it.'
        },
        { status: 409 }
      )
    }

    // Hard delete, in one transaction. The AI service is not told: Taxomind has
    // no delete action yet (it accepts only `create`), so the workspace's
    // model for this key stays there until it is replaced by a new sync.
    const deletionResult = await inCurrentWorkspace(async () => {
      const tx = db()
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
      await tx.aITaxonomySyncJob.deleteMany({ where: { taxonomyId } })

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

    await audit({
      actorId: actor.id,
      action: 'taxonomy.deleted',
      entityType: 'taxonomy',
      entityId: taxonomyId,
      payload: {
        key: taxonomyKey,
        nodes: deletionResult.deletedNodes,
        annotations: deletionResult.deletedAnnotations,
        aiSuggestions: deletionResult.deletedAISuggestions
      }
    })
    return NextResponse.json({
      ok: true,
      message: 'Taxonomy and all associated data deleted successfully',
      deleted: {
        nodes: deletionResult.deletedNodes,
        annotations: deletionResult.deletedAnnotations,
        aiSuggestions: deletionResult.deletedAISuggestions,
        synonyms: deletionResult.deletedSynonyms
      }
    })
  } catch (caught) {
    const error = caught as CaughtError
    await logError('Delete taxonomy failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error)
      },
      { status: 500 }
    )
  }
})
