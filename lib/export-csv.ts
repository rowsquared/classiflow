import type { Prisma } from '@/lib/generated/prisma/client'
import { db, withWorkspace } from '@/lib/workspace/db'
import { isUnknownNodeCode } from '@/lib/constants'
import { csvLine, type CsvColumn } from '@/lib/csv'
import { logError } from '@/lib/logger'
import { recordStatus, taxonomyStatus, type OutcomeState } from '@/lib/double-annotation'

/**
 * Streaming CSV export of one workspace's records
 * (GET /api/workspaces/[workspaceId]/export). Records are read in pages of
 * BATCH_SIZE, in import order, so memory stays flat however many records are
 * exported: one light pass decides the columns, a second streams the rows.
 * Each page is read in its own short workspace transaction after checking the
 * caller may still export, so a revoked admin stops receiving rows.
 *
 * Columns: id (the record key from the import); field_<name> and support_<name> in the order the names first
 * occur; then per taxonomy (by key) <key>_<level> human labels and
 * <key>_ai<level>/<key>_ai<level>c AI suggestions; then status, flagged,
 * last_editor, last_edited, comments; then annotation_mode (single/double),
 * annotation_status (unlabelled, partial, provisional, needs_review,
 * confirmed) and <key>_annotation_status per taxonomy (lib/double-annotation.ts
 * taxonomyStatus). The label columns hold the record's current result, which
 * for double annotation can be provisional: the status columns say so.
 * Unknown codes export as UNKNOWN.
 *
 * detailsStream(): the double-annotation details, one row per record, round,
 * labeller and taxonomy, with each person's own answer.
 */

const BATCH_SIZE = 1000
const ORDER: Prisma.SentenceOrderByWithRelationInput[] = [{ importId: 'asc' }, { importOrder: 'asc' }, { id: 'asc' }]
const SLOTS = [1, 2, 3, 4, 5] as const

type Mapping = Record<string, string>

export type ExportScope = {
  workspaceId: string
  /** Re-checked before every page; false ends the export with an error. */
  stillAllowed: () => Promise<boolean>
}

/** Runs one read in a fresh, re-authorised workspace transaction. */
function scoped<T>(scope: ExportScope, read: () => Promise<T>): Promise<T> {
  return (async () => {
    if (!(await scope.stillAllowed())) throw new Error('Export no longer allowed for this user')
    return withWorkspace(scope.workspaceId, read)
  })()
}
type FieldSlots = Record<`field${1 | 2 | 3 | 4 | 5}` | `support${1 | 2 | 3 | 4 | 5}`, string | null>

/** Pages through the matching records in export order. */
async function* pages<T extends { id: string }>(
  where: Prisma.SentenceWhereInput,
  read: (args: {
    where: Prisma.SentenceWhereInput
    orderBy: typeof ORDER
    take: number
    cursor?: { id: string }
    skip?: number
  }) => Promise<T[]>
): AsyncGenerator<T[]> {
  let cursor: string | null = null
  while (true) {
    const batch = await read({
      where,
      orderBy: ORDER,
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    })
    const last = batch.at(-1)
    if (!last) return
    yield batch
    if (batch.length < BATCH_SIZE) return
    cursor = last.id
  }
}

const slotSelect = Object.fromEntries(
  SLOTS.flatMap(i => [
    [`field${i}`, true],
    [`support${i}`, true]
  ])
) as Record<keyof FieldSlots, true>

type ColumnPlan = {
  columns: CsvColumn[]
  fields: string[]
  supports: string[]
  taxonomies: Array<{ id: string; key: string; maxDepth: number }>
  /** Ordinary records are complete when every active taxonomy is labelled. */
  activeTaxonomyIds: string[]
}

/** Refuses an export whose generated headers would collide (e.g. unusual taxonomy keys). */
function assertUniqueHeaders(columns: CsvColumn[]) {
  const seen = new Set<string>()
  for (const { header } of columns) {
    if (seen.has(header)) throw new ExportColumnError(`Two export columns would be called "${header}"`)
    seen.add(header)
  }
}

export class ExportColumnError extends Error {}

async function planColumns(scope: ExportScope, where: Prisma.SentenceWhereInput): Promise<ColumnPlan> {
  const fields: string[] = []
  const supports: string[] = []
  const seen = new Set<string>()
  const add = (list: string[], name: string) => {
    if (!seen.has(name)) {
      seen.add(name)
      list.push(name)
    }
  }
  for await (const batch of pages(where, args =>
    scoped(scope, () =>
      db().sentence.findMany({
        ...args,
        select: { id: true, fieldMapping: true, supportMapping: true, ...slotSelect }
      })
    )
  )) {
    for (const s of batch) {
      const fieldMapping = (s.fieldMapping ?? {}) as Mapping
      const supportMapping = (s.supportMapping ?? {}) as Mapping
      for (const i of SLOTS) {
        if (Object.hasOwn(fieldMapping, String(i)) || s[`field${i}`])
          add(fields, `field_${fieldMapping[i] || `field${i}`}`)
        if (Object.hasOwn(supportMapping, String(i)) || s[`support${i}`])
          add(supports, `support_${supportMapping[i] || `support${i}`}`)
      }
    }
  }

  const taxonomies = (
    await scoped(scope, () =>
      db().taxonomy.findMany({
        where: {
          workspaceId: scope.workspaceId,
          OR: [
            { annotations: { some: { sentence: where } } },
            { aiSuggestions: { some: { sentence: where } } },
            { doubleOutcomes: { some: { sentence: where } } }
          ]
        },
        select: { id: true, key: true, maxDepth: true },
        orderBy: { key: 'asc' }
      })
    )
  ).map(t => ({ ...t, maxDepth: t.maxDepth || 5 }))
  const activeTaxonomyIds = (
    await scoped(scope, () => db().taxonomy.findMany({ where: { isActive: true }, select: { id: true } }))
  ).map(t => t.id)

  const text = (header: string) => ({ header, text: true })
  const plain = (header: string) => ({ header })
  const columns: CsvColumn[] = [
    plain('id'),
    ...fields.map(text),
    ...supports.map(text),
    ...taxonomies.flatMap(t => Array.from({ length: t.maxDepth }, (_, l) => plain(`${t.key}_${l + 1}`))),
    ...taxonomies.flatMap(t =>
      Array.from({ length: t.maxDepth }, (_, l) => [plain(`${t.key}_ai${l + 1}`), plain(`${t.key}_ai${l + 1}c`)]).flat()
    ),
    plain('status'),
    plain('flagged'),
    text('last_editor'),
    plain('last_edited'),
    text('comments'),
    plain('annotation_mode'),
    plain('annotation_status'),
    ...taxonomies.map(t => plain(`${t.key}_annotation_status`))
  ]
  assertUniqueHeaders(columns)
  return { columns, fields, supports, taxonomies, activeTaxonomyIds }
}

const exportCode = (code: string) => (isUnknownNodeCode(code) ? 'UNKNOWN' : code)

async function readRows(args: Omit<Prisma.SentenceFindManyArgs, 'include' | 'select'>) {
  return db().sentence.findMany({
    ...args,
    include: {
      annotations: { where: { source: 'user' }, select: { taxonomyId: true, level: true, nodeCode: true } },
      aiSuggestions: { select: { taxonomyId: true, level: true, nodeCode: true, confidenceScore: true } },
      comments: { select: { body: true, author: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      lastEditor: { select: { name: true } },
      // The latest double-annotation round that was not stopped.
      doubleRounds: {
        where: { status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { outcomes: { select: { taxonomyId: true, state: true } } }
      }
    }
  })
}

function toRow(s: Awaited<ReturnType<typeof readRows>>[number], plan: ColumnPlan): string[] {
  const fieldMapping = (s.fieldMapping ?? {}) as Mapping
  const supportMapping = (s.supportMapping ?? {}) as Mapping
  const valueFor = (column: string, prefix: 'field' | 'support', mapping: Mapping) => {
    const name = column.slice(prefix.length + 1)
    const slot = SLOTS.find(i => (mapping[i] || `${prefix}${i}`) === name)
    return slot ? (s[`${prefix}${slot}`] ?? '') : ''
  }
  const labels = new Map(s.annotations.map(a => [`${a.taxonomyId}:${a.level}`, a.nodeCode]))
  const suggestions = new Map(s.aiSuggestions.map(a => [`${a.taxonomyId}:${a.level}`, a]))

  const row: string[] = [s.recordKey]
  for (const column of plan.fields) row.push(valueFor(column, 'field', fieldMapping))
  for (const column of plan.supports) row.push(valueFor(column, 'support', supportMapping))
  for (const t of plan.taxonomies) {
    for (let level = 1; level <= t.maxDepth; level++) {
      const code = labels.get(`${t.id}:${level}`)
      row.push(code ? exportCode(code) : '')
    }
  }
  for (const t of plan.taxonomies) {
    for (let level = 1; level <= t.maxDepth; level++) {
      const ai = suggestions.get(`${t.id}:${level}`)
      row.push(ai ? exportCode(ai.nodeCode) : '', ai ? ai.confidenceScore.toFixed(4) : '')
    }
  }
  row.push(
    s.status,
    s.flagged ? 'true' : 'false',
    s.lastEditor?.name || '',
    s.lastEditedAt ? s.lastEditedAt.toISOString() : '',
    s.comments.map(c => `[${c.author.name || 'Unknown'}]: ${c.body}`).join(' | ')
  )

  const round = s.doubleRounds[0]
  const outcomes = new Map(round?.outcomes.map(o => [o.taxonomyId, o.state as OutcomeState]))
  const labelled = new Set(s.annotations.map(a => a.taxonomyId))
  const statusOf = (taxonomyId: string) =>
    taxonomyStatus({
      outcome: round ? { state: outcomes.get(taxonomyId) ?? 'waiting' } : null,
      hasLabels: labelled.has(taxonomyId)
    })
  const required = round ? round.outcomes.map(o => o.taxonomyId) : plan.activeTaxonomyIds
  row.push(round ? 'double' : 'single', recordStatus(required.map(statusOf)))
  for (const t of plan.taxonomies) {
    row.push(!round || outcomes.has(t.id) ? statusOf(t.id) : labelled.has(t.id) ? 'single' : 'unlabelled')
  }
  return row
}

/**
 * The export as a byte stream. `onDone` receives the number of records written
 * once the last row is sent (not called if the stream fails or is cancelled).
 */
export async function exportStream(
  scope: ExportScope,
  filter: Prisma.SentenceWhereInput,
  opts: { neutralizeFormulas: boolean; onDone?: (records: number) => Promise<void> | void }
): Promise<ReadableStream<Uint8Array>> {
  const where = { ...filter, workspaceId: scope.workspaceId }
  const plan = await planColumns(scope, where)
  const encoder = new TextEncoder()
  const iterator = pages(where, args => scoped(scope, () => readRows(args)))
  let records = 0

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          csvLine(
            plan.columns,
            plan.columns.map(c => c.header),
            { neutralizeFormulas: false }
          )
        )
      )
    },
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          await opts.onDone?.(records)
          controller.close()
          return
        }
        const lines = next.value.map(s => '\n' + csvLine(plan.columns, toRow(s, plan), opts))
        records += next.value.length
        controller.enqueue(encoder.encode(lines.join('')))
      } catch (error) {
        await logError('Export failed while streaming', error, { records })
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return(undefined)
    }
  })
}

// ---------------------------------------------------------------------------
// Double-annotation details: each person's own answer.

const DETAIL_HEADERS = [
  'id',
  'round',
  'round_status',
  'round_started',
  'position',
  'labeller',
  'labeller_status',
  'from_existing_labels',
  'taxonomy',
  'code_1',
  'code_2',
  'code_3',
  'code_4',
  'code_5',
  'answered_at',
  'original_match',
  'result_status',
  'reviewed_by',
  'reviewed_at',
  'review_note'
]
const DETAIL_COLUMNS: CsvColumn[] = DETAIL_HEADERS.map(header => ({
  header,
  text: header === 'labeller' || header === 'reviewed_by' || header === 'review_note'
}))

async function readDetailRows(args: Omit<Prisma.SentenceFindManyArgs, 'include' | 'select'>) {
  return db().sentence.findMany({
    ...args,
    select: {
      id: true,
      recordKey: true,
      doubleRounds: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          tasks: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              position: true,
              status: true,
              fromBaseline: true,
              assignee: { select: { name: true } },
              labels: { select: { taxonomyId: true, level: true, nodeCode: true, createdAt: true } }
            }
          },
          outcomes: {
            select: {
              taxonomyId: true,
              state: true,
              matched: true,
              reviewedAt: true,
              note: true,
              reviewedBy: { select: { name: true } }
            }
          }
        }
      }
    }
  })
}

/** Details CSV of double annotation: records that were ever in a round, admin export only. */
export async function detailsStream(
  scope: ExportScope,
  filter: Prisma.SentenceWhereInput,
  opts: { neutralizeFormulas: boolean; onDone?: (records: number) => Promise<void> | void }
): Promise<ReadableStream<Uint8Array>> {
  const where = { ...filter, workspaceId: scope.workspaceId, doubleRounds: { some: {} } }
  const taxonomyKeys = new Map(
    (await scoped(scope, () => db().taxonomy.findMany({ select: { id: true, key: true } }))).map(t => [t.id, t.key])
  )
  const encoder = new TextEncoder()
  const iterator = pages(where, args => scoped(scope, () => readDetailRows(args)))
  let records = 0

  const rowsFor = (s: Awaited<ReturnType<typeof readDetailRows>>[number]): string[][] =>
    s.doubleRounds.flatMap(round =>
      round.outcomes
        .slice()
        .sort((a, b) => (taxonomyKeys.get(a.taxonomyId) ?? '').localeCompare(taxonomyKeys.get(b.taxonomyId) ?? ''))
        .flatMap(outcome =>
          round.tasks.map(task => {
            const labels = task.labels.filter(l => l.taxonomyId === outcome.taxonomyId)
            const code = (level: number) => labels.find(l => l.level === level)?.nodeCode ?? ''
            const answeredAt = labels[0]?.createdAt
            return [
              s.recordKey,
              round.id,
              round.status,
              round.createdAt.toISOString(),
              String(task.position),
              task.assignee?.name ?? '',
              task.status,
              task.fromBaseline ? 'true' : 'false',
              taxonomyKeys.get(outcome.taxonomyId) ?? '',
              code(1),
              code(2),
              code(3),
              code(4),
              code(5),
              answeredAt ? answeredAt.toISOString() : '',
              outcome.matched === null ? '' : String(outcome.matched),
              outcome.state,
              outcome.reviewedBy?.name ?? '',
              outcome.reviewedAt ? outcome.reviewedAt.toISOString() : '',
              outcome.note ?? ''
            ]
          })
        )
    )

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvLine(DETAIL_COLUMNS, DETAIL_HEADERS, { neutralizeFormulas: false })))
    },
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          await opts.onDone?.(records)
          controller.close()
          return
        }
        const lines = next.value.flatMap(rowsFor).map(row => '\n' + csvLine(DETAIL_COLUMNS, row, opts))
        records += next.value.length
        controller.enqueue(encoder.encode(lines.join('')))
      } catch (error) {
        await logError('Details export failed while streaming', error, { records })
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return(undefined)
    }
  })
}
