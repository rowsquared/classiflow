import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { sentenceVisibilityFilter } from '@/lib/access'
import { AnnotationSource, SentenceStatus, type Prisma } from '@prisma/client'
import { parseEnum, type CaughtError } from '@/lib/utils'

type AISuggestionView = {
  id: string
  level: number
  nodeCode: string
  nodeLabel: string | null
  source: 'ai'
  taxonomy: { key: string }
  confidenceScore: number | null
}

export async function GET(request: Request) {
  try {
    const { user, error: authError } = await requireSession()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const q = searchParams.get('q') || ''
    const statusParam = searchParams.get('status') || ''
    const userId = searchParams.get('userId') || ''
    const assignedToUserId = searchParams.get('assignedToUserId') || ''
    const lastEditorId = searchParams.get('lastEditorId') || ''
    const lastEditedFrom = searchParams.get('lastEditedFrom') || ''
    const lastEditedTo = searchParams.get('lastEditedTo') || ''
    const taxonomyKey = searchParams.get('taxonomyKey') || ''
    const level = searchParams.get('level') || ''
    const code = searchParams.get('code') || ''
    const source = searchParams.get('source') || '' // 'ai' or 'user'
    const aiTaxonomyKey = searchParams.get('aiTaxonomyKey') || ''
    const aiLevel = searchParams.get('aiLevel') || ''
    const aiCode = searchParams.get('aiCode') || ''
    const aiConfidenceMin = searchParams.get('aiConfidenceMin') || ''
    const aiConfidenceMax = searchParams.get('aiConfidenceMax') || ''
    const flagged = searchParams.get('flagged') || ''
    const hasComments = searchParams.get('hasComments') || ''
    const hasSubmittedLabels = searchParams.get('hasSubmittedLabels') || ''
    const hasAISuggestions = searchParams.get('hasAISuggestions') || ''
    const importId = searchParams.get('importId') || ''
    const sort = searchParams.get('sort') || 'createdAt'
    const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc'
    // The UI offers page sizes up to 10000 ("all"); anything else is clamped.
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 10000)

    // Build where clause
    const and: Prisma.SentenceWhereInput[] = []
    
    // Search across all field columns
    if (q) {
      and.push({
        OR: [
          { field1: { contains: q, mode: 'insensitive' } },
          { field2: { contains: q, mode: 'insensitive' } },
          { field3: { contains: q, mode: 'insensitive' } },
          { field4: { contains: q, mode: 'insensitive' } },
          { field5: { contains: q, mode: 'insensitive' } }
        ]
      })
    }
    
    // Multiple status filters (comma-separated)
    if (statusParam) {
      const statuses = statusParam.split(',')
        .map(s => parseEnum(SentenceStatus, s.trim()))
        .filter((s): s is SentenceStatus => s !== undefined)
      if (statuses.length === 1) {
        and.push({ status: statuses[0] })
      } else if (statuses.length > 1) {
        and.push({
          OR: statuses.map(s => ({ status: s }))
        })
      }
    }
    
    // Visibility filtering based on role and assignments (admins: no filter)
    and.push(await sentenceVisibilityFilter(user))

    // Additional user filter (for admins/supervisors to filter by specific user)
    if (userId) {
      and.push({ lastEditorId: userId })
    }
    
    // Assigned to user filter
    if (assignedToUserId) {
      if (assignedToUserId === 'unassigned') {
        // Filter for sentences with no assignments
        and.push({
          assignments: {
            none: {}
          }
        })
      } else {
        // Filter for sentences assigned to specific user
        and.push({
          assignments: {
            some: {
              userId: assignedToUserId
            }
          }
        })
      }
    }

    if (lastEditorId) {
      and.push({ lastEditorId })
    }
    
    // Date range filter
    if (lastEditedFrom || lastEditedTo) {
      const dateFilter: Prisma.DateTimeNullableFilter = {}
      if (lastEditedFrom) {
        // Start of the day (00:00:00.000)
        const fromDate = new Date(lastEditedFrom)
        fromDate.setHours(0, 0, 0, 0)
        dateFilter.gte = fromDate
      }
      if (lastEditedTo) {
        // End of the day (23:59:59.999)
        const toDate = new Date(lastEditedTo)
        toDate.setHours(23, 59, 59, 999)
        dateFilter.lte = toDate
      }
      and.push({ lastEditedAt: dateFilter })
    }
    
    // Taxonomy/annotation filters
    if (taxonomyKey || level || code || source) {
      const annotationFilter: Prisma.SentenceAnnotationWhereInput = {}
      
      if (taxonomyKey) {
        annotationFilter.taxonomy = { key: taxonomyKey }
      }
      if (level) {
        annotationFilter.level = parseInt(level, 10)
      }
      if (code) {
        annotationFilter.nodeCode = code
      }
      if (source) {
        annotationFilter.source = parseEnum(AnnotationSource, source)
      }
      
      and.push({ annotations: { some: annotationFilter } })
    }
    
    // AI suggestion filters
    if (aiTaxonomyKey || aiLevel || aiCode || aiConfidenceMin || aiConfidenceMax) {
      const aiFilter: Prisma.SentenceAISuggestionWhereInput = {}
      if (aiTaxonomyKey) {
        aiFilter.taxonomy = { key: aiTaxonomyKey }
      }
      if (aiLevel) {
        aiFilter.level = parseInt(aiLevel, 10)
      }
      if (aiCode) {
        aiFilter.nodeCode = aiCode
      }
      const confidenceFilter: Prisma.FloatFilter = {}
      if (aiConfidenceMin) {
        const minVal = parseFloat(aiConfidenceMin)
        if (!Number.isNaN(minVal)) {
          confidenceFilter.gte = minVal
        }
      }
      if (aiConfidenceMax) {
        const maxVal = parseFloat(aiConfidenceMax)
        if (!Number.isNaN(maxVal)) {
          confidenceFilter.lte = maxVal
        }
      }
      if (Object.keys(confidenceFilter).length > 0) {
        aiFilter.confidenceScore = confidenceFilter
      }
      and.push({
        aiSuggestions: {
          some: aiFilter
        }
      })
    }

    if (hasSubmittedLabels === 'true') {
      and.push({
        annotations: {
          some: {}
        }
      })
    } else if (hasSubmittedLabels === 'false') {
      and.push({
        annotations: {
          none: {}
        }
      })
    }

    if (hasAISuggestions === 'true') {
      and.push({
        aiSuggestions: {
          some: {}
        }
      })
    } else if (hasAISuggestions === 'false') {
      and.push({
        aiSuggestions: {
          none: {}
        }
      })
    }
    
    // Flagged filter
    if (flagged === 'true') {
      and.push({ flagged: true })
    } else if (flagged === 'false') {
      and.push({ flagged: false })
    }
    
    // Has comments filter
    if (hasComments === 'true') {
      and.push({ 
        comments: { 
          some: {} 
        } 
      })
    } else if (hasComments === 'false') {
      and.push({ 
        comments: { 
          none: {} 
        } 
      })
    }
    
    // Import file filter
    if (importId) {
      and.push({ importId })
    }
    
    // Support column filters (dynamic)
    for (let i = 1; i <= 5; i++) {
      const supportValue = searchParams.get(`support${i}`)
      if (supportValue) {
        and.push({
          [`support${i}`]: { contains: supportValue, mode: 'insensitive' }
        } as Prisma.SentenceWhereInput)
      }
    }
    
    const where: Prisma.SentenceWhereInput = and.length > 0 ? { AND: and } : {}

    // Build orderBy clause with secondary sort by importOrder for stable ordering
    let orderBy: Prisma.SentenceOrderByWithRelationInput[]
    if (sort === 'lastEditedAt') {
      orderBy = [
        { lastEditedAt: order },
        { importOrder: 'asc' } // Secondary sort by import order
      ]
    } else if (sort === 'createdAt') {
      orderBy = [
        { createdAt: order },
        { importOrder: 'asc' } // Secondary sort by import order
      ]
    } else if (sort === 'status') {
      orderBy = [
        { status: order },
        { importOrder: 'asc' } // Secondary sort by import order
      ]
    } else {
      orderBy = [{ id: order }]
    }

    // Fetch sentences + total count in parallel
    const [sentences, total] = await Promise.all([
      prisma.sentence.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          annotations: {
            include: {
              taxonomy: {
                select: { key: true }
              }
            }
          },
          comments: {
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: {
                select: { name: true }
              }
            }
          },
          lastEditor: {
            select: {
              name: true,
              username: true,
              email: true
            }
          },
          assignments: {
            select: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true
                }
              }
            }
          },
          _count: {
            select: { comments: true }
          }
        }
      }),
      prisma.sentence.count({ where })
    ])
    
    // Build sets for annotation nodes
    const annotationTaxonomyIds = new Set<string>()
    const annotationNodeCodes = new Set<string>()
    sentences.forEach(sentence => {
      sentence.annotations.forEach(annotation => {
        annotationTaxonomyIds.add(annotation.taxonomyId)
        annotationNodeCodes.add(annotation.nodeCode)
      })
    })
    
    const annotationNodesPromise = annotationTaxonomyIds.size > 0 && annotationNodeCodes.size > 0
      ? prisma.taxonomyNode.findMany({
          where: {
            taxonomyId: { in: Array.from(annotationTaxonomyIds) },
            code: { in: Array.from(annotationNodeCodes) }
          },
          select: {
            taxonomyId: true,
            code: true,
            label: true
          }
        })
      : Promise.resolve([])
    
    // Prepare AI suggestions fetch (only for sentences without annotations)
    const sentencesWithoutAnnotations = sentences.filter(s => s.annotations.length === 0)
    const aiSuggestionsPromise = (async () => {
      if (sentencesWithoutAnnotations.length === 0) {
        return {} as Record<string, AISuggestionView[]>
      }
      
      const sentenceIds = sentencesWithoutAnnotations.map(s => s.id)
      const aiSuggestions = await prisma.sentenceAISuggestion.findMany({
        where: {
          sentenceId: { in: sentenceIds }
        },
        include: {
          taxonomy: {
            select: { key: true }
          }
        },
        orderBy: [
          { taxonomyId: 'asc' },
          { level: 'asc' }
        ]
      })
      
      if (aiSuggestions.length === 0) {
        return {} as Record<string, AISuggestionView[]>
      }
      
      const aiTaxonomyIds = new Set(aiSuggestions.map(s => s.taxonomyId))
      const aiNodeCodes = new Set(aiSuggestions.map(s => s.nodeCode))
      
      const aiNodes = await prisma.taxonomyNode.findMany({
        where: {
          taxonomyId: { in: Array.from(aiTaxonomyIds) },
          code: { in: Array.from(aiNodeCodes) }
        },
        select: {
          taxonomyId: true,
          code: true,
          label: true
        }
      })
      
      const aiNodeLabels = new Map(
        aiNodes.map(n => [`${n.taxonomyId}-${n.code}`, n.label])
      )
      
      return aiSuggestions.reduce((acc, suggestion) => {
        if (!acc[suggestion.sentenceId]) {
          acc[suggestion.sentenceId] = []
        }
        acc[suggestion.sentenceId].push({
          id: suggestion.id,
          level: suggestion.level,
          nodeCode: suggestion.nodeCode,
          nodeLabel: aiNodeLabels.get(`${suggestion.taxonomyId}-${suggestion.nodeCode}`) || null,
          source: 'ai' as const,
          taxonomy: {
            key: suggestion.taxonomy.key,
          },
          confidenceScore: suggestion.confidenceScore
        })
        return acc
      }, {} as Record<string, AISuggestionView[]>)
    })()
    
    const [annotationNodes, aiSuggestionsBySentence] = await Promise.all([annotationNodesPromise, aiSuggestionsPromise])
    
    const nodeLabels = new Map(
      annotationNodes.map(n => [`${n.taxonomyId}-${n.code}`, n.label])
    )
    
    // Attach labels to annotations; sentences without annotations show their AI suggestions instead
    const sentencesWithLabels = sentences.map(s => {
      if (s.annotations.length === 0 && aiSuggestionsBySentence[s.id]) {
        return {
          ...s,
          annotations: aiSuggestionsBySentence[s.id]
        }
      }
      return {
        ...s,
        annotations: s.annotations.map(a => ({
          ...a,
          nodeLabel: nodeLabels.get(`${a.taxonomyId}-${a.nodeCode}`) || null
        }))
      }
    })

    return NextResponse.json({
      sentences: sentencesWithLabels,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Sentences API error:', error)
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    })
    return NextResponse.json({ 
      error: error?.message || String(error),
      details: process.env.NODE_ENV === 'development' ? {
        code: error?.code,
        meta: error?.meta
      } : undefined
    }, { status: 500 })
  }
}
