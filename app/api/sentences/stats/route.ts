import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AnnotationSource, SentenceStatus, type Prisma } from '@prisma/client'
import { parseEnum, type CaughtError } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    // Get authenticated session
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)

    // Build base visibility filter based on role
    let visibilityFilter: Prisma.SentenceWhereInput = {}
    
    if (session.user.role === 'labeller') {
      // Labellers can only see sentences assigned to them
      visibilityFilter = {
        assignments: {
          some: {
            userId: session.user.id
          }
        }
      }
    } else if (session.user.role === 'supervisor') {
      // Supervisors can see sentences assigned to themselves and their team
      const supervisor = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
          labellers: {
            include: {
              labellers: true // Nested - get labellers of supervised supervisors
            }
          }
        }
      })

      if (supervisor) {
        const visibleUserIds = new Set<string>([session.user.id])
        supervisor.labellers.forEach(labeller => {
          visibleUserIds.add(labeller.id)
          // Add nested labellers
          labeller.labellers.forEach(nestedLabeller => {
            visibleUserIds.add(nestedLabeller.id)
          })
        })

        visibilityFilter = {
          assignments: {
            some: {
              userId: { in: Array.from(visibleUserIds) }
            }
          }
        }
      }
    }
    // Admins see all sentences (no filter)

    // Build additional filters from query params
    const AND: Prisma.SentenceWhereInput[] = []

    // Search query
    const q = searchParams.get('q')
    if (q) {
      const searchFilter: Prisma.SentenceWhereInput = {
        OR: [
          { field1: { contains: q, mode: 'insensitive' } },
          { field2: { contains: q, mode: 'insensitive' } },
          { field3: { contains: q, mode: 'insensitive' } },
          { field4: { contains: q, mode: 'insensitive' } },
          { field5: { contains: q, mode: 'insensitive' } }
        ]
      }
      AND.push(searchFilter)
    }

    // Status filter (from filter panel, not tab)
    const validStatuses = Object.values(SentenceStatus) as string[]
    const statuses = searchParams.getAll('status')
      .filter((s): s is SentenceStatus => validStatuses.includes(s))
    if (statuses.length > 0) {
      AND.push({ status: { in: statuses } })
    }

    // User filter (last editor)
    const userId = searchParams.get('userId')
    if (userId) {
      AND.push({ lastEditorId: userId })
    }

    // Last editor filter
    const lastEditorId = searchParams.get('lastEditorId')
    if (lastEditorId) {
      AND.push({ lastEditorId })
    }

    // Assigned to filter
    const assignedToUserId = searchParams.get('assignedToUserId')
    if (assignedToUserId) {
      if (assignedToUserId === 'unassigned') {
        // Filter for sentences with no assignments
        AND.push({
          assignments: {
            none: {}
          }
        })
      } else {
        AND.push({
          assignments: {
            some: { userId: assignedToUserId }
          }
        })
      }
    }

    // Date range filter
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeNullableFilter = {}
      if (dateFrom) dateFilter.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      AND.push({ lastEditedAt: dateFilter })
    }

    // Taxonomy/Label filters
    const taxonomyKey = searchParams.get('taxonomyKey')
    const level = searchParams.get('level')
    const code = searchParams.get('code')
    const source = searchParams.get('source')
    const aiTaxonomyKey = searchParams.get('aiTaxonomyKey')
    const aiLevel = searchParams.get('aiLevel')
    const aiCode = searchParams.get('aiCode')
    const aiConfidenceMin = searchParams.get('aiConfidenceMin')
    const aiConfidenceMax = searchParams.get('aiConfidenceMax')
    const hasSubmittedLabels = searchParams.get('hasSubmittedLabels')
    const hasAISuggestions = searchParams.get('hasAISuggestions')
    const importId = searchParams.get('importId')

    if (taxonomyKey || level || code || source) {
      const annotationFilter: Prisma.SentenceAnnotationWhereInput = {}
      if (taxonomyKey) {
        const taxonomy = await prisma.taxonomy.findUnique({
          where: { key: taxonomyKey },
          select: { id: true }
        })
        if (taxonomy) {
          annotationFilter.taxonomyId = taxonomy.id
        }
      }
      if (level) annotationFilter.level = parseInt(level)
      if (code) annotationFilter.nodeCode = code
      if (source) annotationFilter.source = parseEnum(AnnotationSource, source)

      AND.push({ annotations: { some: annotationFilter } })
    }
    
    if (aiTaxonomyKey || aiLevel || aiCode || aiConfidenceMin || aiConfidenceMax) {
      const aiFilter: Prisma.SentenceAISuggestionWhereInput = {}
      if (aiTaxonomyKey) {
        aiFilter.taxonomy = { key: aiTaxonomyKey }
      }
      if (aiLevel) {
        aiFilter.level = parseInt(aiLevel)
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
      AND.push({
        aiSuggestions: {
          some: aiFilter
        }
      })
    }

    if (hasSubmittedLabels === 'true') {
      AND.push({
        annotations: {
          some: {}
        }
      })
    } else if (hasSubmittedLabels === 'false') {
      AND.push({
        annotations: {
          none: {}
        }
      })
    }

    if (hasAISuggestions === 'true') {
      AND.push({
        aiSuggestions: {
          some: {}
        }
      })
    } else if (hasAISuggestions === 'false') {
      AND.push({
        aiSuggestions: {
          none: {}
        }
      })
    }

    // Flagged filter
    const flagged = searchParams.get('flagged')
    if (flagged !== null) {
      AND.push({ flagged: flagged === 'true' })
    }

    // Has comments filter
    const hasComments = searchParams.get('hasComments')
    if (hasComments !== null) {
      if (hasComments === 'true') {
        AND.push({
          comments: {
            some: {}
          }
        })
      }
    }

    // Import file filter
    if (importId) {
      AND.push({ importId })
    }

    // Support column filters (dynamic)
    for (let i = 1; i <= 5; i++) {
      const supportValue = searchParams.get(`support${i}`)
      if (supportValue) {
        AND.push({
          [`support${i}`]: { contains: supportValue, mode: 'insensitive' }
        } as Prisma.SentenceWhereInput)
      }
    }

    // Combine visibility filter with additional filters
    const where: Prisma.SentenceWhereInput = {
      ...visibilityFilter,
      ...(AND.length > 0 ? { AND } : {})
    }
    
    // Get counts by status with all filters applied
    const [total, pending, submitted, skipped, flaggedCount] = await Promise.all([
      prisma.sentence.count({ where }),
      prisma.sentence.count({ where: { ...where, status: 'pending' } }),
      prisma.sentence.count({ where: { ...where, status: 'submitted' } }),
      prisma.sentence.count({ where: { ...where, status: 'skipped' } }),
      prisma.sentence.count({ where: { ...where, flagged: true } })
    ])
    
    return NextResponse.json({
      ok: true,
      stats: {
        total,
        pending,
        submitted,
        skipped,
        flagged: flaggedCount,
        progress: total > 0 ? Math.round((submitted / total) * 100) : 0
      }
    })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to fetch sentence stats:', error)
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    })
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || String(error),
      details: process.env.NODE_ENV === 'development' ? {
        code: error?.code,
        meta: error?.meta
      } : undefined
    }, { status: 500 })
  }
}

