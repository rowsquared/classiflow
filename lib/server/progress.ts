import 'server-only'
import { db } from '@/lib/workspace/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser, Role } from '@/lib/api-auth'
import { getVisibleUserIds, sentenceVisibilityFilter, teamMembers, visibleMembers, type MemberRef } from '@/lib/access'
import { computeAgreement } from '@/lib/metrics'
import { UNKNOWN_NODE_CODE_SET } from '@/lib/constants'
import type {
  DateRange,
  PeopleQuery,
  PeopleSort,
  ProgressOverview,
  ProgressPeople,
  ProgressPerson,
  ProgressTimeline,
  ReportFilter,
  ReportMeta
} from '@/lib/contracts/progress'
import {
  bucketsFor,
  normalizeRange,
  resolveTimeZone,
  type Granularity,
  type ReportingRange
} from '@/lib/reporting-dates'

// Progress page data (app/progress) and /api/progress/*. Each function applies
// the caller's visibility itself: admins see everyone, supervisors their team
// subtree, labellers their own work.
//
// getProgressStats and getProgressTimeline serve the current Progress page
// until the dashboard (docs/plans/progress-dashboard.md, D3) replaces it with
// the reports at the end of this file; they count lastEditedAt, not activity.

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

  const completionRate = totalSentences > 0 ? Math.round((completedCurrent / totalSentences) * 100) : 0

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

  const estimatedDaysToComplete = velocityCurrent > 0 ? Math.ceil(remainingSentences / velocityCurrent) : null

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
    const suggestions =
      humanLabels.length === 0
        ? []
        : await db().sentenceAISuggestion.findMany({
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

  const medianTimeCurrent = labelingTimes[0]?.median_seconds ? Math.round(labelingTimes[0].median_seconds) : null

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
    allDates.push(currentDate.toISOString().slice(0, 10))

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
      const sentenceDate = s.lastEditedAt.toISOString().slice(0, 10)
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

/**
 * Per-member figures for the caller's team (admins: everyone). One grouped
 * query for all members (W08/M07): the query count does not grow with the team.
 */
export async function getTeamProgress(user: CurrentUser, { start, end }: DateRange) {
  const ws = user.workspaceId
  const members = await visibleMembers(user)
  const memberFilter = members === null ? Prisma.empty : Prisma.sql`AND wm.id = ANY(${members.map(m => m.id)}::text[])`
  const rows = await db().$queryRaw<
    Array<{
      userId: string
      name: string
      email: string
      role: Role
      totalAssigned: number
      totalCompleted: number
      pending: number
      completedInPeriod: number
      skippedInPeriod: number
      flaggedInPeriod: number
      median: number | null
      agreementTotal: number
      agreementMatches: number
    }>
  >`
    WITH m AS (
      SELECT wm.id, wm."userId", wm.role::text AS role, u.name, u.email
        FROM "WorkspaceMembership" wm JOIN "User" u ON u.id = wm."userId"
       WHERE wm."workspaceId" = ${ws} ${memberFilter}
    ), work AS (
      SELECT a."membershipId" AS id,
             count(*)::int AS "totalAssigned",
             count(*) FILTER (WHERE s.status = 'submitted')::int AS "totalCompleted",
             count(*) FILTER (WHERE s.status = 'pending')::int AS pending,
             count(*) FILTER (WHERE s.status = 'submitted' AND s."lastEditedAt" BETWEEN ${start} AND ${end})::int AS "completedInPeriod",
             count(*) FILTER (WHERE s.status = 'skipped' AND s."lastEditedAt" BETWEEN ${start} AND ${end})::int AS "skippedInPeriod",
             count(*) FILTER (WHERE s.flagged AND s."lastEditedAt" BETWEEN ${start} AND ${end})::int AS "flaggedInPeriod"
        FROM "SentenceAssignment" a
        JOIN "Sentence" s ON s."workspaceId" = a."workspaceId" AND s.id = a."sentenceId"
       WHERE a."workspaceId" = ${ws} AND a."membershipId" IN (SELECT id FROM m)
       GROUP BY a."membershipId"
    ), med AS (
      SELECT "createdById" AS "userId",
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "labelingStartedAt"))) AS median
        FROM "SentenceAnnotation"
       WHERE "workspaceId" = ${ws}
         AND "labelingStartedAt" IS NOT NULL
         AND "createdAt" - "labelingStartedAt" < INTERVAL '30 minutes'
         AND "createdAt" BETWEEN ${start} AND ${end}
         AND "createdById" IN (SELECT "userId" FROM m)
       GROUP BY "createdById"
    ), agree AS (
      -- lib/metrics.ts computeAgreement, in SQL: human labels with a suggestion
      -- for the same record, taxonomy and level, and how many match.
      SELECT a."createdById" AS "userId",
             count(*)::int AS total,
             count(*) FILTER (WHERE g."nodeCode" = a."nodeCode")::int AS matches
        FROM "SentenceAnnotation" a
        JOIN "SentenceAISuggestion" g
          ON g."sentenceId" = a."sentenceId" AND g."taxonomyId" = a."taxonomyId" AND g.level = a.level
       WHERE a."workspaceId" = ${ws}
         AND a.source = 'user'
         AND a."createdAt" BETWEEN ${start} AND ${end}
         AND a."createdById" IN (SELECT "userId" FROM m)
       GROUP BY a."createdById"
    )
    SELECT m."userId", m.name, m.email, m.role,
           COALESCE(work."totalAssigned", 0) AS "totalAssigned",
           COALESCE(work."totalCompleted", 0) AS "totalCompleted",
           COALESCE(work.pending, 0) AS pending,
           COALESCE(work."completedInPeriod", 0) AS "completedInPeriod",
           COALESCE(work."skippedInPeriod", 0) AS "skippedInPeriod",
           COALESCE(work."flaggedInPeriod", 0) AS "flaggedInPeriod",
           med.median,
           COALESCE(agree.total, 0) AS "agreementTotal",
           COALESCE(agree.matches, 0) AS "agreementMatches"
      FROM m
      LEFT JOIN work ON work.id = m.id
      LEFT JOIN med ON med."userId" = m."userId"
      LEFT JOIN agree ON agree."userId" = m."userId"
     ORDER BY lower(m.name), m.id`

  return {
    ok: true,
    period: {
      start: start.toISOString(),
      end: end.toISOString()
    },
    team: rows.map(row => ({
      id: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      stats: {
        totalAssigned: row.totalAssigned,
        totalCompleted: row.totalCompleted,
        pending: row.pending,
        completedInPeriod: row.completedInPeriod,
        skippedInPeriod: row.skippedInPeriod,
        flaggedInPeriod: row.flaggedInPeriod,
        medianTime: row.median ? Math.round(Number(row.median)) : null,
        aiAgreementRate: row.agreementTotal > 0 ? Math.round((row.agreementMatches / row.agreementTotal) * 100) : null,
        aiAgreementTotal: row.agreementTotal
      }
    }))
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

// ---------------------------------------------------------------------------
// Progress reports: overview, timeline and people (docs/plans/progress-dashboard.md).
//
// Workload is "now": the records in scope and their current status. Activity
// is "in the period": distinct records with a successful human label save
// (LabelingActivity) by the selected actors, in records the viewer may see.
// Every report runs a fixed number of queries, whatever the team size: one for
// the workspace's settings, at most three to resolve the scope, one (people:
// at most two) for the figures.
// ---------------------------------------------------------------------------

/** A person or team selector the viewer may not use (or that does not exist here). */
export class ReportScopeError extends Error {
  constructor() {
    super('You cannot report on this person or team')
  }
}

/**
 * Who and what a report covers. Membership ids select assignments, user ids
 * select actors; null means no restriction.
 */
type ReportScope = {
  /** Records the viewer may see: assigned to these memberships (null: all). */
  visible: string[] | null
  /** Workload: records assigned to these memberships (null: every record). */
  workload: string[] | null
  /** Activity by these users (null: anyone). */
  actors: string[] | null
  /** Rows of the people table (null: every membership). */
  people: string[] | null
}

async function resolveReportScope(user: CurrentUser, filter: ReportFilter): Promise<ReportScope> {
  const visible = await visibleMembers(user)
  const isVisible = (id: string) => visible === null || visible.some(m => m.id === id)
  const memberOf = async (userId: string) => {
    const membership = await db().workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: user.workspaceId, userId } },
      select: { id: true, userId: true }
    })
    if (!membership || !isVisible(membership.id)) throw new ReportScopeError()
    return membership
  }

  // A selector narrows within the viewer's own scope and never widens it.
  let selected: MemberRef[] | null = null
  if (filter.teamId) {
    if (user.role === 'labeller') throw new ReportScopeError()
    const root = await memberOf(filter.teamId)
    selected = await teamMembers(user.workspaceId, root.id)
  }
  if (filter.personId) {
    const person = await memberOf(filter.personId)
    // Team and person together: the intersection.
    selected = selected === null || selected.some(m => m.id === person.id) ? [person] : []
  }

  const ids = (members: MemberRef[]) => members.map(m => m.id)
  const visibleIds = visible && ids(visible)
  if (selected !== null) {
    return { visible: visibleIds, workload: ids(selected), actors: selected.map(m => m.userId), people: ids(selected) }
  }
  return {
    visible: visibleIds,
    workload: visibleIds,
    actors: visible && visible.map(m => m.userId),
    people: visibleIds
  }
}

type ReportContext = { meta: ReportMeta; range: ReportingRange; scope: ReportScope }

/** Settings, range and scope shared by the reports. Throws ReportScopeError; a bad range is an error result. */
async function reportContext(user: CurrentUser, filter: ReportFilter): Promise<Report<ReportContext>> {
  const workspace = await db().workspace.findUniqueOrThrow({
    where: { id: user.workspaceId },
    select: { reportingTimezone: true, activityTrackedSince: true }
  })
  const timeZone = resolveTimeZone(workspace.reportingTimezone, process.env.REPORTING_TIMEZONE)
  const { range, error } = normalizeRange(filter, timeZone)
  if (error !== undefined) return { error }
  const scope = await resolveReportScope(user, filter)
  return {
    data: {
      range,
      scope,
      meta: {
        startDate: range.startDate,
        endDate: range.endDate,
        timeZone,
        personId: filter.personId ?? null,
        teamId: filter.teamId ?? null,
        generatedAt: new Date().toISOString(),
        activityCoverageStart: workspace.activityTrackedSince.toISOString()
      }
    }
  }
}

/** `AND <record> is assigned to one of the memberships` (no condition for null). */
function assignedTo(memberships: string[] | null, sentenceId: Prisma.Sql) {
  if (memberships === null) return Prisma.empty
  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM "SentenceAssignment" sa
     WHERE sa."sentenceId" = ${sentenceId} AND sa."membershipId" = ANY(${memberships}::text[]))`
}

/** Activity rows of the period by the scope's actors, in records the viewer may see. */
function activityWhere(workspaceId: string, { range, scope }: ReportContext) {
  return Prisma.sql`
    e."workspaceId" = ${workspaceId}
    AND e."createdAt" >= ${range.from} AND e."createdAt" < ${range.to}
    ${scope.actors === null ? Prisma.empty : Prisma.sql`AND e."actorId" = ANY(${scope.actors}::text[])`}
    ${assignedTo(scope.visible, Prisma.sql`e."sentenceId"`)}`
}

/** A report, or the message for a 400 (invalid range or granularity). */
export type Report<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

/** Workload now (cards) and records labeled in the period. */
export async function getProgressOverview(user: CurrentUser, filter: ReportFilter): Promise<Report<ProgressOverview>> {
  const { data: context, error } = await reportContext(user, filter)
  if (error !== undefined) return { error }
  const [row] = await db().$queryRaw<
    Array<Omit<ProgressOverview['workload'], 'remaining'> & { labeledRecords: number }>
  >`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE s.status = 'submitted')::int AS complete,
           count(*) FILTER (WHERE s.status = 'pending')::int AS pending,
           count(*) FILTER (WHERE s.status = 'skipped')::int AS skipped,
           count(*) FILTER (WHERE s.status = 'escalated')::int AS escalated,
           count(*) FILTER (WHERE s.flagged)::int AS flagged,
           (SELECT count(DISTINCT e."sentenceId")::int FROM "LabelingActivity" e
             WHERE ${activityWhere(user.workspaceId, context)}) AS "labeledRecords"
      FROM "Sentence" s
     WHERE s."workspaceId" = ${user.workspaceId} ${assignedTo(context.scope.workload, Prisma.sql`s.id`)}`
  const { labeledRecords, ...counts } = row!
  return {
    data: {
      ...context.meta,
      workload: { ...counts, remaining: counts.total - counts.complete },
      activity: { labeledRecords }
    }
  }
}

/** Distinct records labeled per day or Monday week, every bucket of the range present. */
export async function getProgressActivity(
  user: CurrentUser,
  filter: ReportFilter & { granularity: Granularity }
): Promise<Report<ProgressTimeline>> {
  const { data: context, error } = await reportContext(user, filter)
  if (error !== undefined) return { error }
  const { buckets, error: bucketError } = bucketsFor(context.range, filter.granularity)
  if (bucketError !== undefined) return { error: bucketError }
  const rows = await db().$queryRaw<Array<{ key: string; labeledRecords: number }>>`
    SELECT to_char(date_trunc(${filter.granularity}::text,
             (e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${context.range.timeZone}::text), 'YYYY-MM-DD') AS key,
           count(DISTINCT e."sentenceId")::int AS "labeledRecords"
      FROM "LabelingActivity" e
     WHERE ${activityWhere(user.workspaceId, context)}
     GROUP BY 1`
  const counts = new Map(rows.map(r => [r.key, r.labeledRecords]))
  return {
    data: {
      ...context.meta,
      granularity: filter.granularity,
      buckets: buckets.map(b => ({ ...b, labeledRecords: counts.get(b.key) ?? 0 }))
    }
  }
}

const PEOPLE_ORDER: Record<PeopleSort, Prisma.Sql> = {
  name: Prisma.sql`lower(name)`,
  role: Prisma.sql`CASE role WHEN 'admin' THEN 0 WHEN 'supervisor' THEN 1 ELSE 2 END`,
  assigned: Prisma.sql`assigned`,
  complete: Prisma.sql`complete`,
  remaining: Prisma.sql`remaining`,
  labeled: Prisma.sql`"labeledRecords"`,
  lastSeen: Prisma.sql`"lastSeenAt"`
}

/** One page of people: workload by current assignment, activity by actor. */
export async function getProgressPeople(user: CurrentUser, query: PeopleQuery): Promise<Report<ProgressPeople>> {
  const { data: context, error } = await reportContext(user, query)
  if (error !== undefined) return { error }
  const ws = user.workspaceId
  const { people } = context.scope
  const search = query.q ? `%${query.q.replace(/[\\%_]/g, c => `\\${c}`)}%` : null
  const direction = Prisma.raw(query.dir === 'desc' ? 'DESC' : 'ASC')
  const order = Prisma.sql`${PEOPLE_ORDER[query.sort]} ${direction} NULLS LAST, username ASC, id ASC`

  const members = Prisma.sql`
    SELECT wm.id, wm."userId", wm.role::text AS role, wm.status::text AS status, wm."lastSeenAt", u.name, u.username
      FROM "WorkspaceMembership" wm JOIN "User" u ON u.id = wm."userId"
     WHERE wm."workspaceId" = ${ws}
       ${people === null ? Prisma.empty : Prisma.sql`AND wm.id = ANY(${people}::text[])`}
       ${search === null ? Prisma.empty : Prisma.sql`AND (u.name ILIKE ${search} OR u.username ILIKE ${search})`}`

  const rows = await db().$queryRaw<
    Array<Omit<ProgressPerson, 'lastSeenAt'> & { lastSeenAt: Date | null; total: number }>
  >`
    WITH m AS (${members}), work AS (
      SELECT a."membershipId" AS id,
             count(*)::int AS assigned,
             count(*) FILTER (WHERE s.status = 'submitted')::int AS complete
        FROM "SentenceAssignment" a
        JOIN "Sentence" s ON s."workspaceId" = a."workspaceId" AND s.id = a."sentenceId"
       WHERE a."workspaceId" = ${ws} AND a."membershipId" IN (SELECT id FROM m)
       GROUP BY a."membershipId"
    ), act AS (
      SELECT e."actorId" AS "userId", count(DISTINCT e."sentenceId")::int AS "labeledRecords"
        FROM "LabelingActivity" e
       WHERE ${activityWhere(ws, context)} AND e."actorId" IN (SELECT "userId" FROM m)
       GROUP BY e."actorId"
    ), rows AS (
      SELECT m.*,
             COALESCE(work.assigned, 0) AS assigned,
             COALESCE(work.complete, 0) AS complete,
             COALESCE(work.assigned, 0) - COALESCE(work.complete, 0) AS remaining,
             COALESCE(act."labeledRecords", 0) AS "labeledRecords"
        FROM m LEFT JOIN work ON work.id = m.id LEFT JOIN act ON act."userId" = m."userId"
    )
    SELECT *, count(*) OVER ()::int AS total FROM rows
     ORDER BY ${order}
     LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`

  // Past the last page no row carries the total: count separately.
  let total = rows[0]?.total ?? 0
  if (rows.length === 0 && query.page > 1) {
    const [count] = await db().$queryRaw<Array<{ total: number }>>`
      WITH m AS (${members}) SELECT count(*)::int AS total FROM m`
    total = count?.total ?? 0
  }

  return {
    data: {
      ...context.meta,
      people: rows.map(row => ({
        userId: row.userId,
        name: row.name,
        username: row.username,
        role: row.role,
        status: row.status,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        assigned: row.assigned,
        complete: row.complete,
        remaining: row.remaining,
        labeledRecords: row.labeledRecords
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      dir: query.dir
    }
  }
}
