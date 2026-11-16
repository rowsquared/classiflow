import 'server-only'
import { LevelKappa, agreementDepth, firstDifferingLevel } from '@/lib/double-annotation'
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
  DoubleProgress,
  ReportFilter,
  ReportMeta
} from '@/lib/contracts/progress'
import {
  bucketsFor,
  normalizeRange,
  REPORTING_TIME_ZONE,
  type Granularity,
  type ReportingRange
} from '@/lib/reporting-dates'

// ---------------------------------------------------------------------------
// Progress reports: overview, timeline and people (docs/archive/plans-2026-10/progress-dashboard.md).
//
// Workload is "now": the records in scope and their current status. Activity
// is "in the period": distinct records with a successful human label save
// (LabelingActivity) by the selected actors, in records the viewer may see.
// Every report runs a fixed number of queries, whatever the team size: one for
// the workspace's settings, at most three to resolve the scope, one (people:
// at most two; overview: three with double annotation) for the figures.
// Activity counts labelling only (kind 'label'): double-annotation review
// decisions are reported in the overview's double section.
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
  const { range, error } = normalizeRange(filter)
  if (error !== undefined) return { error }
  const scope = await resolveReportScope(user, filter)
  return {
    data: {
      range,
      scope,
      meta: {
        startDate: range.startDate,
        endDate: range.endDate,
        timeZone: REPORTING_TIME_ZONE,
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
    AND e.kind = 'label'
    AND e."createdAt" >= ${range.from} AND e."createdAt" < ${range.to}
    ${scope.actors === null ? Prisma.empty : Prisma.sql`AND e."actorId" = ANY(${scope.actors}::text[])`}
    ${assignedTo(scope.visible, Prisma.sql`e."sentenceId"`)}`
}

/** A report, or the message for a 400 (invalid range or granularity). */
export type Report<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

/** Labellers' completion reflects their own work, never another person's answer. */
function workloadStatus(user: CurrentUser, sentence: Prisma.Sql) {
  if (user.role !== 'labeller') return Prisma.sql`${sentence}.status::text`
  return Prisma.sql`COALESCE((
    SELECT t.status::text
      FROM "DoubleTask" t
     WHERE t."sentenceId" = ${sentence}.id AND t."workspaceId" = ${sentence}."workspaceId"
       AND t."assigneeId" = ${user.id} AND t.status <> 'cancelled' AND t."releasedAt" IS NULL
     ORDER BY t."createdAt" DESC
     LIMIT 1
  ), ${sentence}.status::text)`
}

/** Workload now (cards) and records labeled in the period. */
export async function getProgressOverview(user: CurrentUser, filter: ReportFilter): Promise<Report<ProgressOverview>> {
  const { data: context, error } = await reportContext(user, filter)
  if (error !== undefined) return { error }
  const status = workloadStatus(user, Prisma.sql`s`)
  const manager = user.role !== 'labeller'
  const [row] = await db().$queryRaw<
    Array<
      Omit<ProgressOverview['workload'], 'remaining'> & {
        labeledRecords: number
        completedInPeriod: number
      }
    >
  >`
    WITH flags AS (
      SELECT t."sentenceId", bool_or(t.flagged) AS "anyFlag",
        (array_agg(t.flagged ORDER BY t."createdAt" DESC) FILTER (WHERE t."assigneeId" = ${user.id}))[1] AS "ownFlag"
      FROM "DoubleTask" t
      WHERE t."workspaceId" = ${user.workspaceId} AND t.status <> 'cancelled' AND t."releasedAt" IS NULL
        AND (t."assigneeId" = ${user.id} OR (${manager} AND t.flagged))
      GROUP BY t."sentenceId"
    ), period AS (
      SELECT DISTINCT e."sentenceId" FROM "LabelingActivity" e
      WHERE ${activityWhere(user.workspaceId, context)}
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ${status} = 'submitted')::int AS complete,
           count(*) FILTER (WHERE ${status} IN ('pending', 'escalated'))::int AS pending,
           count(*) FILTER (WHERE ${status} = 'skipped')::int AS skipped,
           count(*) FILTER (WHERE COALESCE(f."ownFlag", s.flagged OR f."anyFlag"))::int AS flagged,
           (SELECT count(*)::int FROM period) AS "labeledRecords",
           (SELECT count(*)::int FROM period
               JOIN "Sentence" done ON done."workspaceId" = ${user.workspaceId} AND done.id = period."sentenceId"
              WHERE ${workloadStatus(user, Prisma.sql`done`)} = 'submitted'
                ${assignedTo(context.scope.workload, Prisma.sql`done.id`)}) AS "completedInPeriod"
      FROM "Sentence" s
      LEFT JOIN flags f ON f."sentenceId" = s.id
     WHERE s."workspaceId" = ${user.workspaceId} ${assignedTo(context.scope.workload, Prisma.sql`s.id`)}`
  const { labeledRecords, completedInPeriod, ...counts } = row!
  const double = user.role === 'labeller' ? null : await doubleProgress(user.workspaceId, context)
  return {
    data: {
      ...context.meta,
      workload: { ...counts, remaining: counts.total - counts.complete },
      activity: { labeledRecords },
      double,
      projection: projectCompletion({
        remaining: counts.total - counts.complete,
        completedInPeriod,
        startDate: context.range.startDate,
        endDate: context.range.endDate
      })
    }
  }
}

/** Double annotation figures for the overview, in one query (workload scope). */
async function doubleProgress(workspaceId: string, context: ReportContext): Promise<DoubleProgress> {
  const inScope = assignedTo(context.scope.workload, Prisma.sql`r."sentenceId"`)
  const [row] = await db().$queryRaw<
    Array<
      Pick<DoubleProgress, 'inProgress' | 'needsReview' | 'needsPerson' | 'confirmed' | 'reviewedInPeriod'> & {
        agreement: DoubleProgress['agreement'] | null
        waiting: DoubleProgress['waiting']
      }
    >
  >`
    WITH rounds AS (
      SELECT r.id, r."sentenceId", r.status, r."createdAt"
      FROM "DoubleRound" r WHERE r."workspaceId" = ${workspaceId} ${inScope}
    )
    SELECT
      (SELECT json_build_object(
         'over3', count(*) FILTER (WHERE r."createdAt" < now() - interval '3 days'),
         'over7', count(*) FILTER (WHERE r."createdAt" < now() - interval '7 days'),
         'over14', count(*) FILTER (WHERE r."createdAt" < now() - interval '14 days'))
         FROM "DoubleTask" t JOIN rounds r ON r.id = t."roundId"
        WHERE r.status = 'active' AND t.status IN ('pending', 'skipped')) AS waiting,
      (SELECT count(*)::int FROM rounds r WHERE r.status = 'active') AS "inProgress",
      (SELECT count(*)::int FROM rounds r
        WHERE r.status = 'active'
          AND EXISTS (SELECT 1 FROM "DoubleOutcome" o WHERE o."roundId" = r.id AND o.state = 'disagreed')) AS "needsReview",
      (SELECT count(*)::int FROM rounds r
        WHERE r.status = 'active'
          AND EXISTS (SELECT 1 FROM "DoubleTask" t WHERE t."roundId" = r.id
                       AND (t.status = 'skipped' OR (t.status = 'pending' AND t."assigneeId" IS NULL)))) AS "needsPerson",
      (SELECT count(DISTINCT r."sentenceId")::int FROM rounds r
        WHERE r.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM "DoubleRound" open WHERE open."sentenceId" = r."sentenceId" AND open.status = 'active')) AS confirmed,
      (SELECT count(DISTINCT e."sentenceId")::int FROM "LabelingActivity" e
        WHERE e."workspaceId" = ${workspaceId} AND e.kind = 'review'
          AND e."createdAt" >= ${context.range.from} AND e."createdAt" < ${context.range.to}
          ${assignedTo(context.scope.workload, Prisma.sql`e."sentenceId"`)}) AS "reviewedInPeriod",
      (SELECT json_agg(a ORDER BY a."taxonomyKey") FROM (
         SELECT tx.key AS "taxonomyKey",
                count(*) FILTER (WHERE o.matched)::int AS agreed,
                count(*)::int AS compared
           FROM "DoubleOutcome" o
           JOIN rounds r ON r.id = o."roundId"
           JOIN "Taxonomy" tx ON tx.id = o."taxonomyId"
          WHERE o."workspaceId" = ${workspaceId} AND o.matched IS NOT NULL AND r.status <> 'cancelled'
            AND o."comparedAt" >= ${context.range.from} AND o."comparedAt" < ${context.range.to}
          GROUP BY tx.key) a) AS agreement`

  // The compared pairs of the period with both answers as they were compared.
  const pairs = await db().$queryRaw<
    Array<{
      taxonomyKey: string
      levelNames: Record<string, string> | null
      matched: boolean
      state: string
      resultCodes: string[]
      a: string[] | null
      b: string[] | null
      aUserId: string | null
      bUserId: string | null
      aName: string | null
      bName: string | null
    }>
  >`
    SELECT tx.key AS "taxonomyKey", tx."levelNames" AS "levelNames", o.matched, o.state::text AS state,
           o."resultCodes" AS "resultCodes", ta."assigneeId" AS "aUserId", tb."assigneeId" AS "bUserId",
           ua.name AS "aName", ub.name AS "bName",
           (SELECT json_agg(l."nodeCode" ORDER BY l.level) FROM "DoubleTaskLabel" l
             WHERE l."taskId" = ta.id AND l."taxonomyId" = o."taxonomyId" AND l."createdAt" <= o."comparedAt"
               AND (l."supersededAt" IS NULL OR l."supersededAt" > o."comparedAt")) AS a,
           (SELECT json_agg(l."nodeCode" ORDER BY l.level) FROM "DoubleTaskLabel" l
             WHERE l."taskId" = tb.id AND l."taxonomyId" = o."taxonomyId" AND l."createdAt" <= o."comparedAt"
               AND (l."supersededAt" IS NULL OR l."supersededAt" > o."comparedAt")) AS b
      FROM "DoubleOutcome" o
      JOIN "DoubleRound" r ON r.id = o."roundId"
      JOIN "Taxonomy" tx ON tx.id = o."taxonomyId"
      LEFT JOIN "DoubleTask" ta ON ta."roundId" = r.id AND ta.position = 1 AND ta.status <> 'cancelled'
      LEFT JOIN "DoubleTask" tb ON tb."roundId" = r.id AND tb.position = 2 AND tb.status <> 'cancelled'
      LEFT JOIN "User" ua ON ua.id = ta."assigneeId"
      LEFT JOIN "User" ub ON ub.id = tb."assigneeId"
     WHERE o."workspaceId" = ${workspaceId} AND o.matched IS NOT NULL AND r.status <> 'cancelled'
       AND o."comparedAt" >= ${context.range.from} AND o."comparedAt" < ${context.range.to}
       ${inScope}`
  const summary = summarizePairs(pairs)
  if (summary.confusions.length > 0) {
    const nodes = await db().taxonomyNode.findMany({
      where: { OR: summary.confusions.map(c => ({ taxonomy: { key: c.taxonomyKey }, code: { in: [c.a, c.b] } })) },
      select: { taxonomy: { select: { key: true } }, code: true, label: true }
    })
    const labels = new Map(nodes.map(n => [JSON.stringify([n.taxonomy.key, n.code]), n.label]))
    for (const confusion of summary.confusions) {
      confusion.aLabel = labels.get(JSON.stringify([confusion.taxonomyKey, confusion.a])) ?? null
      confusion.bLabel = labels.get(JSON.stringify([confusion.taxonomyKey, confusion.b])) ?? null
    }
  }
  return { ...row!, agreement: row!.agreement ?? [], ...summary }
}

/** Agreement by level, per labeller and the most frequent disagreements, from the compared pairs. */
function summarizePairs(
  pairs: Array<{
    taxonomyKey: string
    levelNames: Record<string, string> | null
    matched: boolean
    state: string
    resultCodes: string[]
    a: string[] | null
    b: string[] | null
    aUserId: string | null
    bUserId: string | null
    aName: string | null
    bName: string | null
  }>
): Pick<DoubleProgress, 'agreementByLevel' | 'labellers' | 'confusions'> {
  const byTaxonomy = new Map<
    string,
    { compared: number; agreed: number[]; depth: number; levelNames: string[]; kappa: LevelKappa }
  >()
  const byLabeller = new Map<string | null, DoubleProgress['labellers'][number]>()
  const confusions = new Map<string, DoubleProgress['confusions'][number]>()
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((c, i) => c === y[i])
  for (const p of pairs) {
    const a = p.a ?? []
    const b = p.b ?? []
    const t = byTaxonomy.get(p.taxonomyKey) ?? {
      compared: 0,
      agreed: [0, 0, 0, 0, 0],
      depth: 0,
      kappa: new LevelKappa(),
      levelNames: Object.entries(p.levelNames ?? {})
        .sort(([x], [y]) => Number(x) - Number(y))
        .map(([, name]) => name)
    }
    t.compared++
    t.depth = Math.max(t.depth, a.length, b.length)
    const depth = agreementDepth(a, b)
    for (let l = 0; l < depth; l++) t.agreed[l]!++
    t.kappa.add(a, b)
    byTaxonomy.set(p.taxonomyKey, t)

    const decided = p.state === 'reviewed' && p.resultCodes.length > 0
    for (const [id, name, codes] of [
      [p.aUserId, p.aName, a],
      [p.bUserId, p.bName, b]
    ] as const) {
      const e = byLabeller.get(id) ?? {
        id,
        name: name ?? 'Former member',
        compared: 0,
        agreed: 0,
        decided: 0,
        chosen: 0
      }
      e.compared++
      if (p.matched) e.agreed++
      if (decided) {
        e.decided++
        if (same(p.resultCodes, codes)) e.chosen++
      }
      byLabeller.set(id, e)
    }

    if (!p.matched) {
      const level = firstDifferingLevel(
        a.map((nodeCode, i) => ({ level: i + 1, nodeCode })),
        b.map((nodeCode, i) => ({ level: i + 1, nodeCode }))
      )
      if (level !== null) {
        const [x, y] = [a[level - 1] ?? '', b[level - 1] ?? ''].sort((m, n) => m.localeCompare(n))
        const key = `${p.taxonomyKey}\u0001${level}\u0001${x}\u0001${y}`
        const c = confusions.get(key) ?? {
          taxonomyKey: p.taxonomyKey,
          level,
          a: x!,
          b: y!,
          aLabel: null,
          bLabel: null,
          count: 0
        }
        c.count++
        confusions.set(key, c)
      }
    }
  }
  return {
    agreementByLevel: [...byTaxonomy]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([taxonomyKey, t]) => ({
        taxonomyKey,
        compared: t.compared,
        agreed: t.agreed.slice(0, Math.max(1, t.depth)),
        levelNames: t.levelNames.slice(0, Math.max(1, t.depth)),
        kappa: t.kappa.byLevel(Math.max(1, t.depth)),
        fullKappa: t.kappa.fullPath()
      })),
    labellers: [...byLabeller.values()].sort(
      (x, y) => y.compared - x.compared || x.name.localeCompare(y.name) || (x.id ?? '').localeCompare(y.id ?? '')
    ),
    confusions: [...confusions.values()]
      .sort((x, y) => y.count - x.count || x.taxonomyKey.localeCompare(y.taxonomyKey) || x.a.localeCompare(y.a))
      .slice(0, 10)
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
             e."createdAt"), 'YYYY-MM-DD') AS key,
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
