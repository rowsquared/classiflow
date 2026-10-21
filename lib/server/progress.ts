import 'server-only'
import { db } from '@/lib/workspace/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { getVisibleMembershipIds, getVisibleUserIds, sentenceVisibilityFilter } from '@/lib/access'
import { computeAgreement } from '@/lib/metrics'
import { UNKNOWN_NODE_CODE_SET } from '@/lib/constants'
import type { DateRange } from '@/lib/contracts/progress'

// Progress page data (app/progress) and /api/progress/*. Each function applies
// the caller's visibility itself: admins see everyone, supervisors their team
// subtree, labellers their own work.

/** Completion, velocity, AI agreement, labelling time, unknown rates, flags and comments, with the previous period. */
export async function getProgressStats(user: CurrentUser, { start, end }: DateRange) {
  // Calculate previous period (same duration before start)
  const duration = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - duration)
  const prevEnd = new Date(start.getTime() - 1) // End just before current period starts

  // Records: this workspace's, limited to the caller's team for non-admins.
  // Labels: made by the caller's team (null: anyone in the workspace).
  const sentenceWhere = await sentenceVisibilityFilter(user)
  const visibleUserIds = await getVisibleUserIds(user)
  const byVisibleAuthors: Prisma.SentenceAnnotationWhereInput =
    visibleUserIds === null ? {} : { createdById: { in: visibleUserIds } }

  // 1. COMPLETION RATE
  // Total sentences visible to user
  const totalSentences = await db().sentence.count({
    where: sentenceWhere
  })

  // Completed in current period
  const completedCurrent = await db().sentence.count({
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
  const completedPrevious = await db().sentence.count({
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
  const remainingSentences = await db().sentence.count({
    where: {
      ...sentenceWhere,
      status: { in: ['pending', 'skipped'] }
    }
  })
  
  const estimatedDaysToComplete = velocityCurrent > 0 
    ? Math.ceil(remainingSentences / velocityCurrent)
    : null

  // Human labels made in the period by the visible users (unknown-rate section)
  const annotationWhere: Prisma.SentenceAnnotationWhereInput = {
    createdAt: { gte: start, lte: end },
    source: 'user',
    workspaceId: user.workspaceId,
    ...byVisibleAuthors
  }

  // 3. AI AGREEMENT RATE (lib/metrics.ts): human labels made in the period
  // vs the AI suggestion for the same record, taxonomy and level.
  const agreementFor = async (from: Date, to: Date) => {
    const humanLabels = await db().sentenceAnnotation.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        source: 'user',
        workspaceId: user.workspaceId,
        ...byVisibleAuthors
      },
      select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true }
    })
    const suggestions = humanLabels.length === 0 ? [] : await db().sentenceAISuggestion.findMany({
      where: { sentenceId: { in: Array.from(new Set(humanLabels.map(a => a.sentenceId))) } },
      select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true }
    })
    return computeAgreement(humanLabels, suggestions)
  }
  const agreement = await agreementFor(start, end)
  const agreementPrev = await agreementFor(prevStart, prevEnd)
  const aiAgreementRate = agreement.rate
  const aiAgreementTotal = agreement.total
  const aiAgreementRatePrev = agreementPrev.rate

  // 4. MEDIAN LABELING TIME (excluding outliers > 30 min)
  const labelingTimes = await medianLabelingSeconds(user.workspaceId, visibleUserIds, start, end)

  const medianTimeCurrent = labelingTimes[0]?.median_seconds 
    ? Math.round(labelingTimes[0].median_seconds) 
    : null

  const labelingTimesPrev = await medianLabelingSeconds(user.workspaceId, visibleUserIds, prevStart, prevEnd)

  const medianTimePrevious = labelingTimesPrev[0]?.median_seconds 
    ? Math.round(labelingTimesPrev[0].median_seconds) 
    : null

  // 5. UNKNOWN RATE BY LEVEL
  const unknownByLevel = await db().sentenceAnnotation.groupBy({
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

  const annotationsByLevel = await db().sentenceAnnotation.groupBy({
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
  const flaggedCurrent = await db().sentence.count({
    where: {
      ...sentenceWhere,
      flagged: true,
      lastEditedAt: {
        gte: start,
        lte: end
      }
    }
  })

  const commentsCurrent = await db().comment.count({
    where: {
      createdAt: {
        gte: start,
        lte: end
      },
      sentence: sentenceWhere
    }
  })

  const flaggedPrevious = await db().sentence.count({
    where: {
      ...sentenceWhere,
      flagged: true,
      lastEditedAt: {
        gte: prevStart,
        lte: prevEnd
      }
    }
  })

  const commentsPrevious = await db().comment.count({
    where: {
      createdAt: {
        gte: prevStart,
        lte: prevEnd
      },
      sentence: sentenceWhere
    }
  })

  return {
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
  }
}

/** Records completed, skipped and flagged per day (or week) in the period. */
export async function getProgressTimeline(user: CurrentUser, { start, end }: DateRange, granularity: 'day' | 'week') {
  // This workspace's records, limited to the caller's team for non-admins.
  const sentenceWhere = await sentenceVisibilityFilter(user)

  // Get all sentences in the date range using Prisma
  const sentences = await db().sentence.findMany({
    where: {
      lastEditedAt: {
        gte: start,
        lte: end,
        not: null
      },
      ...sentenceWhere
    },
    select: {
      lastEditedAt: true,
      status: true,
      flagged: true
    }
  })

  // Generate all dates in the period (to fill gaps)
  const allDates: string[] = []
  const currentDate = new Date(start)
  while (currentDate <= end) {
    allDates.push(currentDate.toISOString().split('T')[0])
    
    if (granularity === 'week') {
      currentDate.setDate(currentDate.getDate() + 7)
    } else {
      currentDate.setDate(currentDate.getDate() + 1)
    }
  }

  // Build timeline data array by grouping sentences by date
  const timeline = allDates.map(dateStr => {
    const sentencesOnDate = sentences.filter(s => {
      if (!s.lastEditedAt) return false
      const sentenceDate = s.lastEditedAt.toISOString().split('T')[0]
      return sentenceDate === dateStr
    })

    return {
      date: dateStr,
      completed: sentencesOnDate.filter(s => s.status === 'submitted').length,
      skipped: sentencesOnDate.filter(s => s.status === 'skipped').length,
      flagged: sentencesOnDate.filter(s => s.flagged === true).length
    }
  })

  return {
    ok: true,
    granularity,
    timeline
  }
}

/** Per-member figures for the caller's team (admins: everyone). */
export async function getTeamProgress(user: CurrentUser, { start, end }: DateRange) {
  // Team: every membership for admins, the supervisor and everyone below them otherwise
  const membershipIds = await getVisibleMembershipIds(user)
  const memberships = await db().workspaceMembership.findMany({
    where: { workspaceId: user.workspaceId, ...(membershipIds === null ? {} : { id: { in: membershipIds } }) },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
      assignments: { select: { sentenceId: true } },
    },
  })
  const teamMembers = memberships.map(m => ({
    ...m.user,
    role: m.role,
    assignedSentenceIds: m.assignments.map(a => a.sentenceId),
  }))

  // Calculate stats for each team member
  const teamStats = await Promise.all(teamMembers.map(async (member) => {
    const { assignedSentenceIds } = member

    // Sentences completed in period
    const completed = await db().sentence.count({
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
    const skipped = await db().sentence.count({
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
    const totalCompleted = await db().sentence.count({
      where: {
        id: { in: assignedSentenceIds },
        status: 'submitted'
      }
    })

    // Pending
    const pending = await db().sentence.count({
      where: {
        id: { in: assignedSentenceIds },
        status: 'pending'
      }
    })

    // Flagged in period
    const flagged = await db().sentence.count({
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
    const labelingTimes = await db().$queryRaw<Array<{ median_seconds: number | null }>>`
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
    const userAnnotations = await db().sentenceAnnotation.findMany({
      where: {
        workspaceId: user.workspaceId,
        createdById: member.id,
        createdAt: {
          gte: start,
          lte: end
        },
        source: 'user'
      },
      select: { sentenceId: true, taxonomyId: true, level: true, nodeCode: true }
    })
    const suggestions = userAnnotations.length === 0 ? [] : await db().sentenceAISuggestion.findMany({
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

  return {
    ok: true,
    period: {
      start: start.toISOString(),
      end: end.toISOString()
    },
    team: teamStats
  }
}

/** Median seconds from opening a record to saving a label (sessions over 30 minutes left out). */
async function medianLabelingSeconds(workspaceId: string, authorIds: string[] | null, from: Date, to: Date) {
  if (authorIds !== null && authorIds.length === 0) return [{ median_seconds: null }]
  const byAuthor = authorIds === null ? Prisma.empty : Prisma.sql`AND "createdById" IN (${Prisma.join(authorIds)})`
  return db().$queryRaw<Array<{ median_seconds: number | null }>>`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
      EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))
    ) as median_seconds
    FROM "SentenceAnnotation"
    WHERE "workspaceId" = ${workspaceId}
      AND "labelingStartedAt" IS NOT NULL
      AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
      ${byAuthor}
  `
}
