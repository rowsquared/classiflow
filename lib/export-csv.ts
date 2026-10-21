import type { Prisma } from '@/lib/generated/prisma/client'
import { db, withWorkspace } from '@/lib/workspace/db'
import { isUnknownNodeCode } from '@/lib/constants'
import { csvLine, type CsvColumn } from '@/lib/csv'

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
 * last_editor, last_edited, comments. Unknown codes export as UNKNOWN.
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
}

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
        if (s[`field${i}`]) add(fields, `field_${fieldMapping[i] || `field${i}`}`)
        if (s[`support${i}`]) add(supports, `support_${supportMapping[i] || `support${i}`}`)
      }
    }
  }

  const taxonomies = (
    await scoped(scope, () =>
      db().taxonomy.findMany({
        where: {
          workspaceId: scope.workspaceId,
          OR: [{ annotations: { some: { sentence: where } } }, { aiSuggestions: { some: { sentence: where } } }]
        },
        select: { id: true, key: true, maxDepth: true },
        orderBy: { key: 'asc' }
      })
    )
  ).map(t => ({ ...t, maxDepth: t.maxDepth || 5 }))

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
    text('comments')
  ]
  return { columns, fields, supports, taxonomies }
}

const exportCode = (code: string) => (isUnknownNodeCode(code) ? 'UNKNOWN' : code)

async function readRows(args: Omit<Prisma.SentenceFindManyArgs, 'include' | 'select'>) {
  return db().sentence.findMany({
    ...args,
    include: {
      annotations: { where: { source: 'user' }, select: { taxonomyId: true, level: true, nodeCode: true } },
      aiSuggestions: { select: { taxonomyId: true, level: true, nodeCode: true, confidenceScore: true } },
      comments: { select: { body: true, author: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      lastEditor: { select: { name: true } }
    }
  })
}

function toRow(s: Awaited<ReturnType<typeof readRows>>[number], plan: ColumnPlan): string[] {
  const fieldMapping = (s.fieldMapping ?? {}) as Mapping
  const supportMapping = (s.supportMapping ?? {}) as Mapping
  const valueFor = (column: string, prefix: 'field' | 'support', mapping: Mapping) => {
    const name = column.slice(prefix.length + 1)
    const slot = SLOTS.find(i => mapping[i] === name)
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
        console.error('Export failed while streaming:', error)
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return(undefined)
    }
  })
}
