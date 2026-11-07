import { commentSummaries } from '@/lib/server/comment-summaries'
import 'server-only'
import { db } from '@/lib/workspace/db'
import type { CurrentUser } from '@/lib/api-auth'
import { sentenceVisibilityFilter } from '@/lib/access'
import { AnnotationSource, SentenceStatus, type Prisma } from '@/lib/generated/prisma/client'
import { parseEnum } from '@/lib/utils'
import { PARTICIPATING, ownLabelsWhere, participantWhere, participation } from '@/lib/server/double-annotation'
import { doubleRowSummaries, type DoubleRowSummary } from '@/lib/server/double-queue'

// Queue data for the queue page (app/queue), /api/sentences and
// /api/sentences/stats. Both read the same filter parameters through
// queueWhere(), so the list and its counts always agree.

type AISuggestionView = {
  id: string
  level: number
  nodeCode: string
  nodeLabel: string | null
  source: 'ai'
  taxonomy: { key: string }
  confidenceScore: number | null
}

/**
 * The records the caller may see, narrowed by the queue's filter parameters:
 * q, status, userId, assignedToUserId, lastEditorId, lastEditedFrom/To,
 * taxonomyKey/level/code/source, aiTaxonomyKey/aiLevel/aiCode/aiConfidenceMin/Max,
 * hasSubmittedLabels, hasAISuggestions, flagged, hasComments, importId, support1-5,
 * double (managers: any | review | waiting | gap | done), disagreement (managers:
 * `taxonomyKey,level,codeA,codeB`, see disagreementFilter).
 *
 * Double annotation: for the people who hold a part in a record (any round,
 * docs/plans/double-annotation-v2.md section 2), status, label, editor, flag
 * and comment filters apply to their own part; AI filters skip such records.
 */
export async function queueWhere(user: CurrentUser, searchParams: URLSearchParams): Promise<Prisma.SentenceWhereInput> {
  const parts = await holdsParts(user)
  const q = searchParams.get('q') || ''
  const statusParam = searchParams.getAll('status').join(',')
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

  const and: Prisma.SentenceWhereInput[] = []

  // Search across all field columns
  if (q) and.push(await textSearchFilter(q))

  // Status filters: comma-separated and/or repeated (?status=a,b&status=c)
  if (statusParam) {
    const statuses = statusParam
      .split(',')
      .map(s => parseEnum(SentenceStatus, s.trim()))
      .filter((s): s is SentenceStatus => s !== undefined)
    if (statuses.length > 0) and.push({ OR: statuses.flatMap(s => personalStatusFilter(user, s, parts)) })
  }

  // Visibility filtering based on role and assignments (admins: no filter)
  and.push(await sentenceVisibilityFilter(user))

  // Assigned to user filter
  if (assignedToUserId) {
    if (user.role === 'labeller' && assignedToUserId !== user.id) {
      and.push({ id: { in: [] } })
    }
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
            membership: { userId: assignedToUserId }
          }
        }
      })
    }
  }

  const double = searchParams.get('double') || ''
  if (double && (user.role === 'admin' || user.role === 'supervisor')) {
    const filter = doubleFilter(double)
    if (filter) and.push(filter)
  }
  const disagreement = searchParams.get('disagreement') || ''
  if (disagreement && (user.role === 'admin' || user.role === 'supervisor')) {
    and.push(await disagreementFilter(disagreement))
  }

  // Filters on labels, editors, flags and comments. On records where the
  // caller holds a double-annotation part they apply to that part (own
  // answer, own flag, own comments): what the row shows. AI filters never
  // match such records (their rows show no AI suggestions).
  const ordinary: Prisma.SentenceWhereInput[] = []
  const ownPart: Prisma.SentenceWhereInput[] = []
  let partsExcluded = false
  const byEditor = (editorId: string) => {
    ordinary.push({ lastEditorId: editorId })
    if (editorId === user.id) ownPart.push(ownLabelsWhere(user, {}))
    else partsExcluded = true
  }

  if (userId) byEditor(userId)
  if (lastEditorId) byEditor(lastEditorId)

  // Date range filter
  if (lastEditedFrom || lastEditedTo) {
    const dateFilter: Prisma.DateTimeFilter = {}
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
    ordinary.push({ lastEditedAt: dateFilter })
    ownPart.push(ownLabelsWhere(user, { createdAt: dateFilter }))
  }

  // Taxonomy/annotation filters
  if (taxonomyKey || level || code || source) {
    const annotationFilter: Prisma.SentenceAnnotationWhereInput = {}
    const ownFilter: Prisma.DoubleTaskLabelWhereInput = {}

    if (taxonomyKey) {
      annotationFilter.taxonomy = ownFilter.taxonomy = { key: taxonomyKey }
    }
    if (level) {
      annotationFilter.level = ownFilter.level = parseInt(level, 10)
    }
    if (code) {
      annotationFilter.nodeCode = ownFilter.nodeCode = code
    }
    if (source) {
      annotationFilter.source = parseEnum(AnnotationSource, source)
      if (annotationFilter.source === AnnotationSource.ai) partsExcluded = true
    }

    ordinary.push({ annotations: { some: annotationFilter } })
    ownPart.push(ownLabelsWhere(user, ownFilter))
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
    ordinary.push({ aiSuggestions: { some: aiFilter } })
    partsExcluded = true
  }

  if (hasSubmittedLabels === 'true') {
    ordinary.push({ annotations: { some: {} } })
    ownPart.push(ownLabelsWhere(user, {}))
  } else if (hasSubmittedLabels === 'false') {
    ordinary.push({ annotations: { none: {} } })
    ownPart.push(ownLabelsWhere(user, null))
  }

  if (hasAISuggestions === 'true') {
    ordinary.push({ aiSuggestions: { some: {} } })
    partsExcluded = true
  } else if (hasAISuggestions === 'false') {
    ordinary.push({ aiSuggestions: { none: {} } })
  }

  // Flagged filter
  if (flagged === 'true' || flagged === 'false') {
    const value = flagged === 'true'
    ordinary.push({ flagged: value })
    ownPart.push({ doubleTasks: { some: { assigneeId: user.id, ...PARTICIPATING, flagged: value } } })
  }

  // Has comments filter
  if (hasComments === 'true' || hasComments === 'false') {
    const comments = hasComments === 'true' ? 'some' : 'none'
    ordinary.push({ comments: { [comments]: {} } })
    ownPart.push({ comments: { [comments]: { authorId: user.id } } })
  }

  if (!parts) {
    and.push(...ordinary)
  } else if (ordinary.length > 0 || partsExcluded) {
    const part = participantWhere(user)
    and.push({
      OR: [{ AND: [{ NOT: part }, ...ordinary] }, ...(partsExcluded ? [] : [{ AND: [part, ...ownPart] }])]
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

  return and.length > 0 ? { AND: and } : {}
}

/**
 * Whether `user` holds a live double annotation part in any record of the
 * workspace. Most callers hold none (managers who only review, labellers
 * outside double annotation): their queue filters are then the plain ones,
 * without the per-row participant subqueries, which made a supervisor's
 * counts several times slower on large workspaces (scripts/bench).
 */
async function holdsParts(user: CurrentUser): Promise<boolean> {
  const part = await db().doubleTask.findFirst({
    where: { assigneeId: user.id, ...PARTICIPATING },
    select: { id: true }
  })
  return part !== null
}

/** A record's status, or for the people who hold a double-annotation part in it, their own part's status. */
function personalStatusFilter(user: CurrentUser, status: SentenceStatus, parts: boolean): Prisma.SentenceWhereInput[] {
  if (!parts) return [{ status }]
  const mine = (taskStatus: Prisma.DoubleTaskWhereInput['status']): Prisma.SentenceWhereInput => ({
    doubleTasks: { some: { assigneeId: user.id, ...PARTICIPATING, status: taskStatus } }
  })
  const filters: Prisma.SentenceWhereInput[] = [{ AND: [{ status }, { NOT: mine({ not: 'cancelled' }) }] }]
  if (status === 'pending' || status === 'submitted' || status === 'skipped') filters.push(mine(status))
  return filters
}

/** The managers' double-annotation filter (`double` parameter). */
function doubleFilter(value: string): Prisma.SentenceWhereInput | null {
  switch (value) {
    case 'any':
      return { doubleRounds: { some: { status: { not: 'cancelled' } } } }
    case 'review':
      return { doubleRounds: { some: { status: 'active', outcomes: { some: { state: 'disagreed' } } } } }
    case 'waiting':
      return { doubleRounds: { some: { status: 'active', outcomes: { none: { state: 'disagreed' } } } } }
    case 'gap':
      return {
        doubleRounds: {
          some: {
            status: 'active',
            tasks: { some: { OR: [{ status: 'skipped' }, { status: 'pending', assigneeId: null }] } }
          }
        }
      }
    case 'done':
      return { doubleRounds: { some: { status: 'completed' }, none: { status: 'active' } } }
    default:
      return null
  }
}

/**
 * Managers: records whose double annotation answers, as compared, first differ
 * at `level` of a taxonomy with the codes `codeA` and `codeB` (either way
 * round): the progress page's "most frequent disagreements" (summarizePairs in
 * lib/server/progress.ts) over all periods. Value `taxonomyKey,level,codeA,codeB`;
 * a malformed value matches nothing.
 */
async function disagreementFilter(value: string): Promise<Prisma.SentenceWhereInput> {
  const parts = value.split(',').map(decodeURIComponent)
  const level = Number(parts[1])
  if (parts.length !== 4 || !Number.isInteger(level) || level < 1 || level > 5) return { id: { in: [] } }
  const [taxonomyKey, , codeA, codeB] = parts as [string, string, string, string]
  const rows = await db().$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT p."sentenceId" AS id FROM (
      SELECT r."sentenceId",
             ARRAY(SELECT l."nodeCode" FROM "DoubleTaskLabel" l
                    WHERE l."taskId" = ta.id AND l."taxonomyId" = o."taxonomyId" AND l."createdAt" <= o."comparedAt"
                      AND (l."supersededAt" IS NULL OR l."supersededAt" > o."comparedAt") ORDER BY l.level) AS a,
             ARRAY(SELECT l."nodeCode" FROM "DoubleTaskLabel" l
                    WHERE l."taskId" = tb.id AND l."taxonomyId" = o."taxonomyId" AND l."createdAt" <= o."comparedAt"
                      AND (l."supersededAt" IS NULL OR l."supersededAt" > o."comparedAt") ORDER BY l.level) AS b
        FROM "DoubleOutcome" o
        JOIN "DoubleRound" r ON r.id = o."roundId"
        JOIN "Taxonomy" tx ON tx.id = o."taxonomyId"
        LEFT JOIN "DoubleTask" ta ON ta."roundId" = r.id AND ta.position = 1 AND ta.status <> 'cancelled'
        LEFT JOIN "DoubleTask" tb ON tb."roundId" = r.id AND tb.position = 2 AND tb.status <> 'cancelled'
       WHERE tx.key = ${taxonomyKey} AND o.matched = false AND r.status <> 'cancelled') p
     WHERE p.a[1:${level - 1}::int] IS NOT DISTINCT FROM p.b[1:${level - 1}::int]
       AND p.a[${level}::int] IS DISTINCT FROM p.b[${level}::int]
       AND ((coalesce(p.a[${level}::int], '') = ${codeA} AND coalesce(p.b[${level}::int], '') = ${codeB})
         OR (coalesce(p.a[${level}::int], '') = ${codeB} AND coalesce(p.b[${level}::int], '') = ${codeA}))`
  return { id: { in: rows.map(r => r.id) } }
}

/** Above this many matches a search term is not selective: scan instead of listing ids. */
const SEARCH_ID_LIMIT = 5000

/**
 * `q` in any field column, case-insensitive (ILIKE '%q%'). Row security keeps
 * the trigram indexes from the runtime role's own ILIKE (not leakproof), so a
 * term of three or more characters is first looked up through
 * app_search_sentences() (prisma/migrations/20261022120000_progress_activity),
 * which uses them within this workspace and returns matching ids. Short or
 * very common terms fall back to the plain filter, a table scan either way.
 */
async function textSearchFilter(q: string): Promise<Prisma.SentenceWhereInput> {
  if (q.length >= 3) {
    const matches = await db().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM app_search_sentences(${q}, ${SEARCH_ID_LIMIT + 1}::int)`
    if (matches.length <= SEARCH_ID_LIMIT) return { id: { in: matches.map(m => m.id) } }
  }
  return {
    OR: [
      { field1: { contains: q, mode: 'insensitive' } },
      { field2: { contains: q, mode: 'insensitive' } },
      { field3: { contains: q, mode: 'insensitive' } },
      { field4: { contains: q, mode: 'insensitive' } },
      { field5: { contains: q, mode: 'insensitive' } }
    ]
  }
}

/** One page of the queue, with label names and, for unlabelled records, AI suggestions. */
export async function listQueue(user: CurrentUser, searchParams: URLSearchParams) {
  const sort = searchParams.get('sort') || 'createdAt'
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc'
  // The UI offers page sizes up to 10000 ("all"); anything else is clamped.
  const requestedPage = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 10000)

  const where = await queueWhere(user, searchParams)

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

  // A page can disappear after records leave the filtered queue.
  if (sort === 'createdAt' || sort === 'lastEditedAt' || sort === 'status') orderBy.push({ id: 'asc' })
  const total = await db().sentence.count({ where })
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)))
  const sentences = await db().sentence.findMany({
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
      lastEditor: {
        select: {
          name: true,
          username: true,
          email: true
        }
      },
      assignments: {
        select: {
          membership: { select: { user: { select: { id: true, username: true, name: true, email: true } } } }
        }
      },
      _count: {
        select: { comments: true }
      }
    }
  })

  // Build sets for annotation nodes
  const annotationTaxonomyIds = new Set<string>()
  const annotationNodeCodes = new Set<string>()
  sentences.forEach(sentence => {
    sentence.annotations.forEach(annotation => {
      annotationTaxonomyIds.add(annotation.taxonomyId)
      annotationNodeCodes.add(annotation.nodeCode)
    })
  })

  const annotationNodesPromise =
    annotationTaxonomyIds.size > 0 && annotationNodeCodes.size > 0
      ? db().taxonomyNode.findMany({
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

  // A human label for one taxonomy must not hide suggestions for the others.
  const annotatedTaxonomies = new Set(sentences.flatMap(s => s.annotations.map(a => `${s.id}:${a.taxonomyId}`)))
  const aiSuggestionsPromise = (async () => {
    if (sentences.length === 0) {
      return {} as Record<string, AISuggestionView[]>
    }

    const sentenceIds = sentences.map(s => s.id)
    const aiSuggestions = await db().sentenceAISuggestion.findMany({
      where: {
        sentenceId: { in: sentenceIds }
      },
      include: {
        taxonomy: {
          select: { key: true }
        }
      },
      orderBy: [{ taxonomyId: 'asc' }, { level: 'asc' }]
    })

    if (aiSuggestions.length === 0) {
      return {} as Record<string, AISuggestionView[]>
    }

    const aiTaxonomyIds = new Set(aiSuggestions.map(s => s.taxonomyId))
    const aiNodeCodes = new Set(aiSuggestions.map(s => s.nodeCode))

    const aiNodes = await db().taxonomyNode.findMany({
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

    const aiNodeLabels = new Map(aiNodes.map(n => [`${n.taxonomyId}-${n.code}`, n.label]))

    return aiSuggestions.reduce(
      (acc, suggestion) => {
        if (annotatedTaxonomies.has(`${suggestion.sentenceId}:${suggestion.taxonomyId}`)) return acc
        ;(acc[suggestion.sentenceId] ??= []).push({
          id: suggestion.id,
          level: suggestion.level,
          nodeCode: suggestion.nodeCode,
          nodeLabel: aiNodeLabels.get(`${suggestion.taxonomyId}-${suggestion.nodeCode}`) || null,
          source: 'ai' as const,
          taxonomy: {
            key: suggestion.taxonomy.key
          },
          confidenceScore: suggestion.confidenceScore
        })
        return acc
      },
      {} as Record<string, AISuggestionView[]>
    )
  })()

  // Double annotation: rows the caller holds a part in show their own answer only.
  const pageIds = sentences.map(s => s.id)
  const own = await participation(user, pageIds)
  const blind = new Set(own.keys())
  const [annotationNodes, aiSuggestionsBySentence, summaries, doubleRows] = await Promise.all([
    annotationNodesPromise,
    aiSuggestionsPromise,
    commentSummaries(pageIds, { authorId: user.id, sentenceIds: blind }),
    user.role === 'labeller' ? Promise.resolve(new Map<string, DoubleRowSummary>()) : doubleRowSummaries(pageIds, blind)
  ])
  const ownLabels = [...own.values()].flatMap(t => t.labels)
  const ownTaxonomies = new Map(
    ownLabels.length === 0
      ? []
      : (
          await db().taxonomy.findMany({
            where: { id: { in: Array.from(new Set(ownLabels.map(l => l.taxonomyId))) } },
            select: { id: true, key: true }
          })
        ).map(t => [t.id, t.key])
  )
  const ownNodes =
    ownLabels.length === 0
      ? []
      : await db().taxonomyNode.findMany({
          where: {
            taxonomyId: { in: Array.from(ownTaxonomies.keys()) },
            code: { in: ownLabels.map(l => l.nodeCode) }
          },
          select: { taxonomyId: true, code: true, label: true }
        })

  const nodeLabels = new Map([...annotationNodes, ...ownNodes].map(n => [`${n.taxonomyId}-${n.code}`, n.label]))

  const sentencesWithLabels = sentences.map(({ assignments, ...s }) => {
    const row = {
      ...s,
      commentSummary: summaries.get(s.id) ?? { total: 0, unresolved: 0 },
      assignments: assignments
        .filter(a => user.role !== 'labeller' || a.membership.user.id === user.id)
        .map(a => ({ user: a.membership.user })),
      annotations: [
        ...s.annotations.map(a => ({ ...a, nodeLabel: nodeLabels.get(`${a.taxonomyId}-${a.nodeCode}`) || null })),
        ...(aiSuggestionsBySentence[s.id] ?? [])
      ],
      double: doubleRows.get(s.id) ?? null
    }
    if (!blind.has(s.id)) return row
    const task = own.get(s.id)
    const ownEditedAt =
      task?.labels.reduce<Date | null>(
        (latest, label) => (!latest || label.createdAt > latest ? label.createdAt : latest),
        null
      ) ?? null
    return {
      ...row,
      status: (task && task.task.status !== 'cancelled' ? task.task.status : 'pending') as SentenceStatus,
      flagged: task?.task.flagged ?? false,
      lastEditor: ownEditedAt ? (task?.assignee ?? null) : null,
      lastEditorId: ownEditedAt ? user.id : null,
      lastEditedAt: ownEditedAt,
      _count: { comments: summaries.get(s.id)?.total ?? 0 },
      annotations: (task?.labels ?? []).map(l => ({
        id: `${task!.task.id}:${l.taxonomyId}:${l.level}`,
        workspaceId: s.workspaceId,
        sentenceId: s.id,
        taxonomyId: l.taxonomyId,
        level: l.level,
        nodeCode: l.nodeCode,
        source: AnnotationSource.user,
        createdById: user.id,
        labelingStartedAt: l.labelingStartedAt,
        createdAt: l.createdAt,
        updatedAt: l.createdAt,
        taxonomy: { key: ownTaxonomies.get(l.taxonomyId) ?? '' },
        nodeLabel: nodeLabels.get(`${l.taxonomyId}-${l.nodeCode}`) || null
      }))
    }
  })

  return {
    sentences: sentencesWithLabels,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  }
}

/** Counts per status for the records matching the queue's filters. */
export async function getQueueStats(user: CurrentUser, searchParams: URLSearchParams) {
  const where = await queueWhere(user, searchParams)
  const parts = await holdsParts(user)
  const manager = user.role === 'admin' || user.role === 'supervisor'
  // Managers: double annotation counts for the filter chips, under the same
  // filters except the double filter itself.
  const withoutDouble = new URLSearchParams(searchParams)
  withoutDouble.delete('double')
  const base = manager ? await queueWhere(user, withoutDouble) : where
  const doubleCount = (value: string) =>
    manager ? db().sentence.count({ where: { AND: [base, doubleFilter(value)!] } }) : Promise.resolve(0)
  const any = await doubleCount('any')
  const [waiting, review, gap, done] =
    any > 0 ? await Promise.all(['waiting', 'review', 'gap', 'done'].map(doubleCount)) : [0, 0, 0, 0]
  const [total, pending, submitted, skipped, flagged, needsReview] = await Promise.all([
    db().sentence.count({ where }),
    db().sentence.count({ where: { AND: [where, { OR: personalStatusFilter(user, 'pending', parts) }] } }),
    db().sentence.count({ where: { AND: [where, { OR: personalStatusFilter(user, 'submitted', parts) }] } }),
    db().sentence.count({ where: { AND: [where, { OR: personalStatusFilter(user, 'skipped', parts) }] } }),
    db().sentence.count({
      where: {
        AND: [
          where,
          parts
            ? {
                OR: [
                  { AND: [{ NOT: participantWhere(user) }, { flagged: true }] },
                  { doubleTasks: { some: { assigneeId: user.id, ...PARTICIPATING, flagged: true } } }
                ]
              }
            : { flagged: true }
        ]
      }
    }),
    manager ? db().sentence.count({ where: { AND: [where, doubleFilter('review')!] } }) : Promise.resolve(0)
  ])

  return {
    ok: true as const,
    stats: {
      total,
      pending,
      submitted,
      skipped,
      flagged,
      // Records in double annotation with a disagreement (managers; 0 for labellers).
      needsReview,
      // Managers: records per double annotation state, ignoring the double filter.
      double: { any, waiting, review, gap, done },
      progress: total > 0 ? Math.round((submitted / total) * 100) : 0
    }
  }
}
