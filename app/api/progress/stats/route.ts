import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { requireSession } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'
import { UNKNOWN_NODE_CODE_SET } from '@/lib/constants'

/**
 * GET /api/progress/stats?startDate=...&endDate=...
 * 
 * Returns progress statistics for the current user
 * Includes comparison with previous equivalent period
 */
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireSession()
    if (authError) return authError

    const searchParams = req.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'startDate and endDate are required' 
      }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'startDate and endDate must be valid dates' }, { status: 400 })
    }
    
    // Calculate previous period (same duration before start)
    const duration = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - duration)
    const prevEnd = new Date(start.getTime() - 1) // End just before current period starts

    // Users whose work is visible: [] for admins (everyone), else self (+ team)
    const visibleUserIds = (await getVisibleUserIds(user)) ?? []

    // Build where clause for sentence visibility
    const sentenceWhere: Prisma.SentenceWhereInput = {}
    // For non-admins, filter by assignments
    // Note: For supervisors, visibleUserIds includes both their own ID and supervised users
    if (user.role !== 'admin') {
      if (visibleUserIds.length > 0) {
        sentenceWhere.assignments = {
          some: {
            userId: { in: visibleUserIds }
          }
        }
      } else {
        // If no visible user IDs, return no results (e.g., supervisor with no team and no assignments)
        sentenceWhere.id = 'impossible-id-no-results'
      }
    }

    // 1. COMPLETION RATE
    // Total sentences visible to user
    const totalSentences = await prisma.sentence.count({
      where: sentenceWhere
    })

    // Completed in current period
    const completedCurrent = await prisma.sentence.count({
      where: {
        ...sentenceWhere,
        status: 'submitted',
        lastEditedAt: {
          gte: start,
          lte: end
        }
      }
    })

    // Completed in previous period
    const completedPrevious = await prisma.sentence.count({
      where: {
        ...sentenceWhere,
        status: 'submitted',
        lastEditedAt: {
          gte: prevStart,
          lte: prevEnd
        }
      }
    })

    const completionRate = totalSentences > 0 
      ? Math.round((completedCurrent / totalSentences) * 100) 
      : 0

    // 2. VELOCITY (sentences completed per day)
    const daysInPeriod = Math.max(1, Math.ceil(duration / (1000 * 60 * 60 * 24)))
    const velocityCurrent = Math.round((completedCurrent / daysInPeriod) * 10) / 10
    const velocityPrevious = Math.round((completedPrevious / daysInPeriod) * 10) / 10

    // Estimated days to complete remaining
    const remainingSentences = await prisma.sentence.count({
      where: {
        ...sentenceWhere,
        status: { in: ['pending', 'skipped'] }
      }
    })
    
    const estimatedDaysToComplete = velocityCurrent > 0 
      ? Math.ceil(remainingSentences / velocityCurrent)
      : null

    // 3. AI AGREEMENT RATE
    // Get annotations where both AI and user exist for the same sentence/level
    const annotationWhere: Prisma.SentenceAnnotationWhereInput = {
      createdAt: {
        gte: start,
        lte: end
      }
    }
    
    if (visibleUserIds.length > 0) {
      annotationWhere.createdById = { in: visibleUserIds }
    }

    const userAnnotations = await prisma.sentenceAnnotation.findMany({
      where: {
        ...annotationWhere,
        source: 'user'
      },
      select: {
        sentenceId: true,
        level: true,
        nodeCode: true
      }
    })

    const aiAnnotations = await prisma.sentenceAnnotation.findMany({
      where: {
        sentenceId: { in: userAnnotations.map(a => a.sentenceId) },
        source: 'ai'
      },
      select: {
        sentenceId: true,
        level: true,
        nodeCode: true
      }
    })

    let aiAgreementMatches = 0
    let aiAgreementTotal = 0

    for (const userAnn of userAnnotations) {
      const correspondingAi = aiAnnotations.find(
        ai => ai.sentenceId === userAnn.sentenceId && ai.level === userAnn.level
      )
      if (correspondingAi) {
        aiAgreementTotal++
        if (correspondingAi.nodeCode === userAnn.nodeCode) {
          aiAgreementMatches++
        }
      }
    }

    const aiAgreementRate = aiAgreementTotal > 0
      ? Math.round((aiAgreementMatches / aiAgreementTotal) * 100)
      : null

    // Same for previous period
    const userAnnotationsPrev = await prisma.sentenceAnnotation.findMany({
      where: {
        createdAt: {
          gte: prevStart,
          lte: prevEnd
        },
        ...(visibleUserIds.length > 0 ? { createdById: { in: visibleUserIds } } : {}),
        source: 'user'
      },
      select: {
        sentenceId: true,
        level: true,
        nodeCode: true
      }
    })

    const aiAnnotationsPrev = await prisma.sentenceAnnotation.findMany({
      where: {
        sentenceId: { in: userAnnotationsPrev.map(a => a.sentenceId) },
        source: 'ai'
      },
      select: {
        sentenceId: true,
        level: true,
        nodeCode: true
      }
    })

    let aiAgreementMatchesPrev = 0
    let aiAgreementTotalPrev = 0

    for (const userAnn of userAnnotationsPrev) {
      const correspondingAi = aiAnnotationsPrev.find(
        ai => ai.sentenceId === userAnn.sentenceId && ai.level === userAnn.level
      )
      if (correspondingAi) {
        aiAgreementTotalPrev++
        if (correspondingAi.nodeCode === userAnn.nodeCode) {
          aiAgreementMatchesPrev++
        }
      }
    }

    const aiAgreementRatePrev = aiAgreementTotalPrev > 0
      ? Math.round((aiAgreementMatchesPrev / aiAgreementTotalPrev) * 100)
      : null

    // 4. MEDIAN LABELING TIME (excluding outliers > 30 min)
    const labelingTimes = visibleUserIds.length > 0
      ? await prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
            EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
          ) as median_seconds
          FROM "SentenceAnnotation"
          WHERE "labelingStartedAt" IS NOT NULL
            AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
            AND "createdAt" >= ${start}
            AND "createdAt" <= ${end}
            AND "createdById" IN (${Prisma.join(visibleUserIds)})
        `
      : await prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
            EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
          ) as median_seconds
          FROM "SentenceAnnotation"
          WHERE "labelingStartedAt" IS NOT NULL
            AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
            AND "createdAt" >= ${start}
            AND "createdAt" <= ${end}
        `

    const medianTimeCurrent = labelingTimes[0]?.median_seconds 
      ? Math.round(labelingTimes[0].median_seconds) 
      : null

    const labelingTimesPrev = visibleUserIds.length > 0
      ? await prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
            EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
          ) as median_seconds
          FROM "SentenceAnnotation"
          WHERE "labelingStartedAt" IS NOT NULL
            AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
            AND "createdAt" >= ${prevStart}
            AND "createdAt" <= ${prevEnd}
            AND "createdById" IN (${Prisma.join(visibleUserIds)})
        `
      : await prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
            EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
          ) as median_seconds
          FROM "SentenceAnnotation"
          WHERE "labelingStartedAt" IS NOT NULL
            AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
            AND "createdAt" >= ${prevStart}
            AND "createdAt" <= ${prevEnd}
        `

    const medianTimePrevious = labelingTimesPrev[0]?.median_seconds 
      ? Math.round(labelingTimesPrev[0].median_seconds) 
      : null

    // 5. UNKNOWN RATE BY LEVEL
    const unknownByLevel = await prisma.sentenceAnnotation.groupBy({
      by: ['level'],
      where: {
        ...annotationWhere,
        nodeCode: {
          in: Array.from(UNKNOWN_NODE_CODE_SET)
        }
      },
      _count: {
        id: true
      }
    })

    const annotationsByLevel = await prisma.sentenceAnnotation.groupBy({
      by: ['level'],
      where: annotationWhere,
      _count: {
        id: true
      }
    })

    const unknownRates = annotationsByLevel.map(levelData => {
      const unknownCount = unknownByLevel.find(u => u.level === levelData.level)?._count.id || 0
      const totalCount = levelData._count.id
      return {
        level: levelData.level,
        unknownCount,
        totalCount,
        rate: totalCount > 0 ? Math.round((unknownCount / totalCount) * 100) : 0
      }
    })

    // 6. FLAGS & COMMENTS (absolute counts)
    const flaggedCurrent = await prisma.sentence.count({
      where: {
        ...sentenceWhere,
        flagged: true,
        lastEditedAt: {
          gte: start,
          lte: end
        }
      }
    })

    const commentsCurrent = await prisma.comment.count({
      where: {
        createdAt: {
          gte: start,
          lte: end
        },
        sentence: sentenceWhere
      }
    })

    const flaggedPrevious = await prisma.sentence.count({
      where: {
        ...sentenceWhere,
        flagged: true,
        lastEditedAt: {
          gte: prevStart,
          lte: prevEnd
        }
      }
    })

    const commentsPrevious = await prisma.comment.count({
      where: {
        createdAt: {
          gte: prevStart,
          lte: prevEnd
        },
        sentence: sentenceWhere
      }
    })

    return NextResponse.json({
      ok: true,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        daysInPeriod
      },
      metrics: {
        completion: {
          current: completedCurrent,
          previous: completedPrevious,
          total: totalSentences,
          rate: completionRate
        },
        velocity: {
          current: velocityCurrent,
          previous: velocityPrevious,
          estimatedDaysToComplete
        },
        aiAgreement: {
          current: aiAgreementRate,
          previous: aiAgreementRatePrev,
          totalComparisons: aiAgreementTotal
        },
        medianTime: {
          current: medianTimeCurrent,
          previous: medianTimePrevious
        },
        unknownRates,
        flags: {
          current: flaggedCurrent,
          previous: flaggedPrevious
        },
        comments: {
          current: commentsCurrent,
          previous: commentsPrevious
        }
      }
    })

  } catch (error) {
    console.error('Progress stats error:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined 
    }, { status: 500 })
  }
}

