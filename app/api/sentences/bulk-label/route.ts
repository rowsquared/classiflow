import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { isUnknownNodeCode } from '@/lib/constants'
import type { CaughtError } from '@/lib/utils'
import { Prisma } from '@prisma/client'

const bulkLabelSchema = z.object({
  sentenceIds: z.array(z.string()).min(1),
  taxonomyKey: z.string().min(1),
  annotations: z.array(z.object({
    level: z.number().int().min(1).max(5),
    nodeCode: z.union([z.string(), z.number()])
  })).optional(),
  flagged: z.boolean().optional(),
  comment: z.string().optional(),
  labelingStartedAt: z.string().optional() // ISO timestamp when bulk panel opened
})

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Unauthorized' 
      }, { status: 401 })
    }

    const body = await req.json()
    
    // Validate request body
    const validation = bulkLabelSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Invalid request data'
      }, { status: 400 })
    }
    
    const { sentenceIds, taxonomyKey, annotations, flagged, comment, labelingStartedAt } = validation.data
    const normalizedAnnotations = annotations?.map(ann => ({
      ...ann,
      nodeCode: String(ann.nodeCode)
    }))
    
    // Verify taxonomy exists
    const taxonomy = await prisma.taxonomy.findUnique({
      where: { key: taxonomyKey }
    })
    
    if (!taxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: `Taxonomy '${taxonomyKey}' not found` 
      }, { status: 404 })
    }
    
    // Verify all node codes exist (if annotations provided)
    // Note: -99 is the special code for "unknown" and won't exist in taxonomyNode
    if (normalizedAnnotations && normalizedAnnotations.length > 0) {
      const nodeCodes = normalizedAnnotations.map(a => a.nodeCode).filter(c => !isUnknownNodeCode(c))
      
      if (nodeCodes.length > 0) {
        const nodes = await prisma.taxonomyNode.findMany({
          where: {
            taxonomyId: taxonomy.id,
            code: { in: nodeCodes }
          }
        })
        
        if (nodes.length !== nodeCodes.length) {
          const foundCodes = nodes.map(n => n.code)
          const missingCodes = nodeCodes.filter(c => !foundCodes.includes(c))
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid node codes: ${missingCodes.join(', ')}` 
          }, { status: 400 })
        }
      }
    }
    
    // Get current user ID from session
    const userId = session.user.id
    
    // Parse start time
    const startTime = labelingStartedAt ? new Date(labelingStartedAt) : null
    
    // Perform bulk labeling in transaction
    await prisma.$transaction(async (tx) => {
      // For each sentence
      for (const sentenceId of sentenceIds) {
        // Delete existing annotations for this taxonomy (if annotations provided)
        if (normalizedAnnotations && normalizedAnnotations.length > 0) {
          await tx.sentenceAnnotation.deleteMany({
            where: {
              sentenceId,
              taxonomyId: taxonomy.id
            }
          })
          
          // Create new annotations (including -99 for unknown)
          await tx.sentenceAnnotation.createMany({
            data: normalizedAnnotations.map(ann => {
              const baseData: Prisma.SentenceAnnotationCreateManyInput = {
                sentenceId,
                taxonomyId: taxonomy.id,
                level: ann.level,
                nodeCode: ann.nodeCode, // '-99' for unknown
                source: 'user' as const
              }
              
              if (userId) {
                baseData.createdById = userId
              }
              
              if (startTime) {
                baseData.labelingStartedAt = startTime
              }
              
              return baseData
            })
          })
        }
        
        // Add comment if provided
        if (comment && userId) {
          await tx.comment.create({
            data: {
              body: comment,
              sentenceId,
              authorId: userId
            }
          })
        }
        
        // Update sentence status and flag
        const updateData: Prisma.SentenceUncheckedUpdateInput = {
          status: 'submitted',
          lastEditorId: userId,
          lastEditedAt: new Date()
        }
        
        if (flagged !== undefined) {
          updateData.flagged = flagged
        }
        
        await tx.sentence.update({
          where: { id: sentenceId },
          data: updateData
        })
      }
    })
    
    if (normalizedAnnotations && normalizedAnnotations.length > 0) {
      await prisma.taxonomy.update({
        where: { id: taxonomy.id },
        data: {
          newAnnotationsSinceLastLearning: {
            increment: normalizedAnnotations.length * sentenceIds.length
          }
        }
      })
    }

    return NextResponse.json({
      ok: true,
      labeled: sentenceIds.length,
      message: `Successfully labeled ${sentenceIds.length} sentence(s)`
    })
    
  } catch (caught) {
    
    const error = caught as CaughtError
    console.error('Bulk label error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || String(error) 
    }, { status: 500 })
  }
}

