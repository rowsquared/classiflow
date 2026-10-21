import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'
import { computeAgreement } from '@/lib/metrics'

/**
 * GET /api/progress/team?startDate=...&endDate=...
 * 
 * Returns team member performance (for supervisors and admins only)
 */
export async function GET(req: NextRequest) {
  try {
    // Only supervisors and admins can view team stats
    const { user, error: authError } = await requireSession('supervisor', 'admin')
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

    // Team members: all users for admins, the supervisor and everyone below them otherwise
    const teamMemberIds = (await getVisibleUserIds(user))
      ?? (await prisma.user.findMany({ select: { id: true } })).map(u => u.id)

    // Get team member details with stats
    const teamMembers = await prisma.user.findMany({
      where: {
        id: { in: teamMemberIds }
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        assignedSentences: {
          select: {
            sentence: {
              select: {
                id: true,
                status: true,
                lastEditedAt: true
              }
            }
          }
        }
      }
    })

    // Calculate stats for each team member
    const teamStats = await Promise.all(teamMembers.map(async (member) => {
      const assignedSentenceIds = member.assignedSentences.map(a => a.sentence.id)

      // Sentences completed in period
      const completed = await prisma.sentence.count({
        where: {
          id: { in: assignedSentenceIds },
          status: 'submitted',
          lastEditedAt: {
            gte: start,
            lte: end
          }
        }
      })

      // Sentences skipped in period
      const skipped = await prisma.sentence.count({
        where: {
          id: { in: assignedSentenceIds },
          status: 'skipped',
          lastEditedAt: {
            gte: start,
            lte: end
          }
        }
      })

      // Total assigned
      const totalAssigned = assignedSentenceIds.length

      // Total completed (all time)
      const totalCompleted = await prisma.sentence.count({
        where: {
          id: { in: assignedSentenceIds },
          status: 'submitted'
        }
      })

      // Pending
      const pending = await prisma.sentence.count({
        where: {
          id: { in: assignedSentenceIds },
          status: 'pending'
        }
      })

      // Flagged in period
      const flagged = await prisma.sentence.count({
        where: {
          id: { in: assignedSentenceIds },
          flagged: true,
          lastEditedAt: {
            gte: start,
            lte: end
          }
        }
      })

      // Median time in period
      const labelingTimes = await prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
          EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
        ) as median_seconds
        FROM "SentenceAnnotation"
        WHERE "labelingStartedAt" IS NOT NULL
          AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
          AND "createdAt" >= ${start}
          AND "createdAt" <= ${end}
          AND "createdById" = ${member.id}
      `

      const medianTime = labelingTimes[0]?.median_seconds 
        ? Math.round(labelingTimes[0].median_seconds) 
        : null

      // AI agreement for this user in period (lib/metrics.ts)
      const userAnnotations = await prisma.sentenceAnnotation.findMany({
        where: {
          createdById: member.id,
          createdAt: {
            gte: start,
            lte: end
          },
          source: 'user'
        },
        select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true }
      })
      const suggestions = userAnnotations.length === 0 ? [] : await prisma.sentenceAISuggestion.findMany({
        where: { sentenceId: { in: Array.from(new Set(userAnnotations.map(a => a.sentenceId))) } },
        select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true }
      })
      const { rate: aiAgreementRate, total: aiAgreementTotal } = computeAgreement(userAnnotations, suggestions)

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        stats: {
          totalAssigned,
          totalCompleted,
          pending,
          completedInPeriod: completed,
          skippedInPeriod: skipped,
          flaggedInPeriod: flagged,
          medianTime,
          aiAgreementRate,
          aiAgreementTotal
        }
      }
    }))

    return NextResponse.json({
      ok: true,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      team: teamStats
    })

  } catch (error) {
    console.error('Team stats error:', error)
    return NextResponse.json({ error: 'Failed to load team statistics' }, { status: 500 })
  }
}

