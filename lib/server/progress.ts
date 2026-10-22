import 'server-only'
import { db } from '@/lib/workspace/db'
import { projectCompletion } from '@/lib/progress-projection'
import { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { teamMembers, visibleMembers, type MemberRef } from '@/lib/access'
import type {
  MembersQuery,
  PeopleQuery,
  PeopleSort,
  ProgressOverview,
  ProgressMembers,
  ProgressPeople,
  ProgressPerson,
  ProgressTimeline,
  ReportFilter,
  ReportMeta
} from '@/lib/contracts/progress'
import { bucketsFor, normalizeRange, type Granularity, type ReportingRange } from '@/lib/reporting-dates'

// ---------------------------------------------------------------------------
// Progress reports: overview, timeline and people (docs/archive/plans-2026-10/progress-dashboard.md).
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

/** The membership of a selected user id, if the viewer may see it; ReportScopeError otherwise. */
async function selectableMember(user: CurrentUser, visible: MemberRef[] | null, userId: string): Promise<MemberRef> {
  const membership = await db().workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: user.workspaceId, userId } },
    select: { id: true, userId: true }
  })
  if (!membership || (visible !== null && !visible.some(m => m.id === membership.id))) throw new ReportScopeError()
  return membership
}

async function resolveReportScope(user: CurrentUser, filter: ReportFilter): Promise<ReportScope> {
  const visible = await visibleMembers(user)
  const memberOf = (userId: string) => selectableMember(user, visible, userId)

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
    select: { activityTrackedSince: true }
  })
  const timeZone = 'UTC'
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
    Array<
      Omit<ProgressOverview['workload'], 'remaining'> & {
        labeledRecords: number
        completedInPeriod: number
        importedInPeriod: number
      }
    >
  >`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE s.status = 'submitted')::int AS complete,
           count(*) FILTER (WHERE s.status = 'pending')::int AS pending,
           count(*) FILTER (WHERE s.status = 'skipped')::int AS skipped,
           count(*) FILTER (WHERE s.status = 'escalated')::int AS escalated,
           count(*) FILTER (WHERE s.flagged)::int AS flagged,
           (SELECT count(DISTINCT e."sentenceId")::int FROM "LabelingActivity" e
             WHERE ${activityWhere(user.workspaceId, context)}) AS "labeledRecords"
           ,(SELECT count(DISTINCT e."sentenceId")::int FROM "LabelingActivity" e
               JOIN "Sentence" done ON done."workspaceId" = e."workspaceId" AND done.id = e."sentenceId"
              WHERE ${activityWhere(user.workspaceId, context)} AND done.status = 'submitted'
                ${assignedTo(context.scope.workload, Prisma.sql`done.id`)}) AS "completedInPeriod"
           ,(SELECT count(*)::int FROM "Sentence" incoming
              WHERE incoming."workspaceId" = ${user.workspaceId}
                AND incoming."createdAt" >= GREATEST(${context.range.from}::timestamp, ${new Date(context.meta.activityCoverageStart)}::timestamp)
                AND incoming."createdAt" < ${context.range.to}
                ${assignedTo(context.scope.workload, Prisma.sql`incoming.id`)}) AS "importedInPeriod"
      FROM "Sentence" s
     WHERE s."workspaceId" = ${user.workspaceId} ${assignedTo(context.scope.workload, Prisma.sql`s.id`)}`
  const { labeledRecords, completedInPeriod, importedInPeriod, ...counts } = row!
  return {
    data: {
      ...context.meta,
      workload: { ...counts, remaining: counts.total - counts.complete },
      activity: { labeledRecords },
      projection: projectCompletion({
        remaining: counts.total - counts.complete,
        completedInPeriod,
        importedInPeriod,
        startDate: context.range.startDate,
        endDate: context.range.endDate,
        activityCoverageStart: context.meta.activityCoverageStart,
        timeZone: context.range.timeZone
      })
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

/**
 * Options for the team and person pickers: members the viewer may see whose
 * name or username matches, at most `limit` (`more` says there are others).
 * A person search can be limited to a team. Throws ReportScopeError for a
 * team outside the viewer's scope.
 */
export async function searchReportMembers(user: CurrentUser, query: MembersQuery): Promise<ProgressMembers> {
  const visible = await visibleMembers(user)
  let within: string[] | null = visible && visible.map(m => m.id)
  if (query.kind === 'person' && query.teamId) {
    const root = await selectableMember(user, visible, query.teamId)
    const team = (await teamMembers(user.workspaceId, root.id)).map(m => m.id)
    within = within === null ? team : team.filter(id => within!.includes(id))
  }
  const rows = await db().workspaceMembership.findMany({
    where: {
      workspaceId: user.workspaceId,
      ...(within !== null && { id: { in: within } }),
      ...(query.kind === 'team' && { role: { in: ['admin' as const, 'supervisor' as const] } }),
      ...(query.userId && { userId: query.userId }),
      ...(query.q && {
        user: {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { username: { contains: query.q, mode: 'insensitive' as const } }
          ]
        }
      })
    },
    select: { role: true, status: true, user: { select: { id: true, name: true, username: true } } },
    orderBy: [{ user: { name: 'asc' } }, { user: { username: 'asc' } }],
    take: query.limit + 1
  })
  return {
    members: rows.slice(0, query.limit).map(m => ({
      userId: m.user.id,
      name: m.user.name,
      username: m.user.username,
      role: m.role,
      status: m.status
    })),
    more: rows.length > query.limit
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

  const nameMatches =
    search === null ? Prisma.empty : Prisma.sql`AND (u.name ILIKE ${search} OR u.username ILIKE ${search})`
  // An unrestricted view (admins, no selector) also lists people who labeled
  // here in the period without a membership: platform admins. They have no
  // assignments and cannot be selected; their activity is in the totals.
  const platformOnly =
    people !== null
      ? Prisma.empty
      : Prisma.sql`
    UNION ALL
    SELECT 'platform:' || u.id, u.id, 'admin', 'active', NULL::timestamp(3), u.name, u.username, true
      FROM "User" u
     WHERE u.id IN (SELECT e."actorId" FROM "LabelingActivity" e WHERE ${activityWhere(ws, context)})
       AND NOT EXISTS (SELECT 1 FROM "WorkspaceMembership" x WHERE x."workspaceId" = ${ws} AND x."userId" = u.id)
       ${nameMatches}`
  const members = Prisma.sql`
    SELECT wm.id, wm."userId", wm.role::text AS role, wm.status::text AS status, wm."lastSeenAt", u.name, u.username,
           false AS "platformOnly"
      FROM "WorkspaceMembership" wm JOIN "User" u ON u.id = wm."userId"
     WHERE wm."workspaceId" = ${ws}
       ${people === null ? Prisma.empty : Prisma.sql`AND wm.id = ANY(${people}::text[])`}
       ${nameMatches}
    ${platformOnly}`

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
        platformOnly: row.platformOnly,
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
