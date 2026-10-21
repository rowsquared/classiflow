import 'server-only'
import { db } from '@/lib/workspace/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { teamMembers, visibleMembers, type MemberRef } from '@/lib/access'
import type {
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
