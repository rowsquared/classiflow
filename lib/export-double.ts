import type { Prisma } from '@/lib/generated/prisma/client'
import { db } from '@/lib/workspace/db'
import { csvLine, type CsvColumn } from '@/lib/csv'
import { logError } from '@/lib/logger'
import { firstDifferingLevel } from '@/lib/double-annotation'
import { pages, scoped, secondsSpent, type ExportScope } from '@/lib/export-csv'

/**
 * Double annotation analysis exports (GET /export?format=pairs|agreement,
 * docs/plans/double-annotation-v2.md section 4.2), admin only like every
 * export. Both stream in pages of records that have a matching round.
 *
 * pairs: one row per record, round and taxonomy with answer A (position 1)
 * and answer B side by side, the match per level, the final result and the
 * review. A and B are the answers as they were compared (later revisions are
 * flagged in a_revised/b_revised and listed in the answers file); before a
 * comparison they are the current answers. Codes are raw, including the
 * level-specific unknown codes (-9, -99, ...).
 *
 * agreement: a summary over the same rounds, computed while streaming and
 * written at the end: agreement by level per taxonomy (level L: the two
 * paths agree on levels 1..L, or are identical), by labeller pair and by
 * labeller, and the code pairs that disagree most (first differing level).
 * Only compared pairs count; agreement is the original comparison.
 */

export type AnalysisFilter = {
  /** Round status: all, active (open), completed or cancelled (stopped). */
  rounds: 'all' | 'active' | 'completed' | 'cancelled'
  taxonomyKey: string | null
  /** Comparison date range (inclusive days, UTC). */
  comparedFrom: Date | null
  comparedTo: Date | null
  includeText: boolean
}

const MAX_LEVELS = 5

function roundWhere(filter: AnalysisFilter): Prisma.DoubleRoundWhereInput {
  const outcome: Prisma.DoubleOutcomeWhereInput = {}
  if (filter.taxonomyKey) outcome.taxonomy = { key: filter.taxonomyKey }
  if (filter.comparedFrom || filter.comparedTo) {
    outcome.comparedAt = {
      ...(filter.comparedFrom ? { gte: filter.comparedFrom } : {}),
      ...(filter.comparedTo ? { lte: filter.comparedTo } : {})
    }
  }
  return {
    ...(filter.rounds === 'all' ? {} : { status: filter.rounds }),
    ...(Object.keys(outcome).length > 0 ? { outcomes: { some: outcome } } : {})
  }
}

const outcomeMatches = (
  filter: AnalysisFilter,
  keyOf: Map<string, string>,
  o: { taxonomyId: string; comparedAt: Date | null }
) =>
  (!filter.taxonomyKey || keyOf.get(o.taxonomyId) === filter.taxonomyKey) &&
  (!filter.comparedFrom || (o.comparedAt !== null && o.comparedAt >= filter.comparedFrom)) &&
  (!filter.comparedTo || (o.comparedAt !== null && o.comparedAt <= filter.comparedTo))

async function readPairRecords(
  args: Omit<Prisma.SentenceFindManyArgs, 'include' | 'select'>,
  rounds: Prisma.DoubleRoundWhereInput
) {
  return db().sentence.findMany({
    ...args,
    select: {
      id: true,
      recordKey: true,
      fieldMapping: true,
      supportMapping: true,
      field1: true,
      field2: true,
      field3: true,
      field4: true,
      field5: true,
      support1: true,
      support2: true,
      support3: true,
      support4: true,
      support5: true,
      aiSuggestions: { select: { taxonomyId: true, level: true, nodeCode: true, confidenceScore: true } },
      doubleRounds: {
        where: rounds,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          closedAt: true,
          closeReason: true,
          tasks: {
            where: { status: { not: 'cancelled' } },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              fromBaseline: true,
              assignee: { select: { name: true, username: true } },
              labels: {
                select: {
                  taxonomyId: true,
                  level: true,
                  nodeCode: true,
                  revision: true,
                  supersededAt: true,
                  createdAt: true,
                  labelingStartedAt: true
                },
                orderBy: { level: 'asc' }
              }
            }
          },
          outcomes: {
            select: {
              taxonomyId: true,
              state: true,
              matched: true,
              comparedAt: true,
              sourceTaskId: true,
              resultCodes: true,
              revisedAfterCompare: true,
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

type PairRecord = Awaited<ReturnType<typeof readPairRecords>>[number]
type PairRound = PairRecord['doubleRounds'][number]
type Label = PairRound['tasks'][number]['labels'][number]

/** The answer of a task for a taxonomy as compared (or current, before a comparison). */
function answerAt(labels: Label[], taxonomyId: string, comparedAt: Date | null): Label[] {
  return labels.filter(
    l =>
      l.taxonomyId === taxonomyId &&
      (comparedAt === null
        ? l.supersededAt === null
        : l.createdAt <= comparedAt && (l.supersededAt === null || l.supersededAt > comparedAt))
  )
}

const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i])

export type Pair = {
  record: PairRecord
  round: PairRound
  taxonomyId: string
  outcome: PairRound['outcomes'][number]
  a: { task: PairRound['tasks'][number] | undefined; labels: Label[]; revised: boolean }
  b: { task: PairRound['tasks'][number] | undefined; labels: Label[]; revised: boolean }
}

/** The pairs of a page of records, one per round and taxonomy, in taxonomy key order. */
function pairsOf(record: PairRecord, filter: AnalysisFilter, keyOf: Map<string, string>): Pair[] {
  return record.doubleRounds.flatMap(round =>
    round.outcomes
      .filter(o => outcomeMatches(filter, keyOf, o))
      .sort((x, y) => (keyOf.get(x.taxonomyId) ?? '').localeCompare(keyOf.get(y.taxonomyId) ?? ''))
      .map(outcome => {
        const side = (position: number) => {
          const task = round.tasks.find(t => t.position === position)
          const labels = answerAt(task?.labels ?? [], outcome.taxonomyId, outcome.comparedAt)
          const current = (task?.labels ?? []).filter(l => l.taxonomyId === outcome.taxonomyId && !l.supersededAt)
          const revised =
            outcome.comparedAt !== null &&
            !sameCodes(
              labels.map(l => l.nodeCode),
              current.map(l => l.nodeCode)
            )
          return { task, labels, revised }
        }
        return { record, round, taxonomyId: outcome.taxonomyId, outcome, a: side(1), b: side(2) }
      })
  )
}

/** Levels 1..n where both answers share the same code, counted from level 1. */
export function agreedDepth(a: string[], b: string[]): number {
  let depth = 0
  while (depth < Math.min(a.length, b.length) && a[depth] === b[depth]) depth++
  return depth
}

function finalSource(pair: Pair): string {
  const { outcome } = pair
  const result = outcome.resultCodes
  const codes = (labels: Label[]) => labels.map(l => l.nodeCode)
  if (outcome.state === 'agreed') return 'agreed'
  if (outcome.state === 'accepted_single') {
    const sourcePosition = pair.round.tasks.find(t => t.id === outcome.sourceTaskId)?.position
    return sourcePosition === 2 ? 'single_b' : 'single_a'
  }
  if (outcome.state !== 'reviewed' || result.length === 0) return ''
  if (sameCodes(result, codes(pair.a.labels))) return 'a'
  if (sameCodes(result, codes(pair.b.labels))) return 'b'
  return 'other'
}

async function taxonomyKeys(scope: ExportScope) {
  const taxonomies = await scoped(scope, () =>
    db().taxonomy.findMany({ select: { id: true, key: true, maxDepth: true } })
  )
  return {
    keyOf: new Map(taxonomies.map(t => [t.id, t.key])),
    depthOf: new Map(taxonomies.map(t => [t.id, Math.min(MAX_LEVELS, t.maxDepth || MAX_LEVELS)])),
    depth: Math.min(MAX_LEVELS, Math.max(1, ...taxonomies.map(t => t.maxDepth || MAX_LEVELS)))
  }
}

/** Node labels for (taxonomyId, code) pairs. */
async function nodeLabels(scope: ExportScope, wanted: Array<{ taxonomyId: string; code: string }>) {
  if (wanted.length === 0) return new Map<string, string>()
  const nodes = await scoped(scope, () =>
    db().taxonomyNode.findMany({
      where: {
        taxonomyId: { in: [...new Set(wanted.map(w => w.taxonomyId))] },
        code: { in: [...new Set(wanted.map(w => w.code))] }
      },
      select: { taxonomyId: true, code: true, label: true }
    })
  )
  return new Map(nodes.map(n => [`${n.taxonomyId}:${n.code}`, n.label]))
}

function streamOf(
  header: string,
  next: () => Promise<string | null>,
  opts: { onDone?: (records: number) => Promise<void> | void },
  counter: () => number,
  cancel: () => Promise<unknown>
) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(header))
    },
    async pull(controller) {
      try {
        const chunk = await next()
        if (chunk === null) {
          await opts.onDone?.(counter())
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunk))
      } catch (error) {
        await logError('Double annotation export failed while streaming', error, { records: counter() })
        controller.error(error)
      }
    },
    async cancel() {
      await cancel()
    }
  })
}

type StreamOpts = { neutralizeFormulas: boolean; onDone?: (records: number) => Promise<void> | void }

/** The pairs CSV. */
export async function pairsStream(
  scope: ExportScope,
  filter: Prisma.SentenceWhereInput,
  analysis: AnalysisFilter,
  opts: StreamOpts
): Promise<ReadableStream<Uint8Array>> {
  const rounds = roundWhere(analysis)
  const where = { ...filter, workspaceId: scope.workspaceId, doubleRounds: { some: rounds } }
  const { keyOf, depth } = await taxonomyKeys(scope)
  const levels = Array.from({ length: depth }, (_, i) => i + 1)

  // Field and support names in order of first use (one light pass, as in the records export).
  const fields: string[] = []
  const supports: string[] = []
  if (analysis.includeText) {
    for await (const batch of pages(where, args =>
      scoped(scope, () =>
        db().sentence.findMany({ ...args, select: { id: true, fieldMapping: true, supportMapping: true } })
      )
    )) {
      for (const s of batch) {
        for (const [list, mapping, prefix] of [
          [fields, s.fieldMapping, 'field'],
          [supports, s.supportMapping, 'support']
        ] as const) {
          for (const [slot, name] of Object.entries((mapping ?? {}) as Record<string, string>)) {
            const header = `${prefix}_${name || `${prefix}${slot}`}`
            if (!list.includes(header)) list.push(header)
          }
        }
      }
    }
  }

  const side = (p: 'a' | 'b') => [
    `${p}_labeller`,
    `${p}_username`,
    `${p}_from_existing_labels`,
    `${p}_answered_at`,
    `${p}_seconds`,
    ...levels.map(l => `${p}_code_${l}`),
    `${p}_label`,
    `${p}_revised`
  ]
  const headers = [
    'id',
    ...fields,
    ...supports,
    'taxonomy',
    'round',
    'round_status',
    'round_started',
    'round_closed',
    'close_reason',
    ...side('a'),
    ...side('b'),
    ...levels.map(l => `match_${l}`),
    'agreed_depth',
    'first_diff_level',
    'original_match',
    'compared_at',
    ...levels.map(l => `final_code_${l}`),
    'final_label',
    'final_source',
    'result_status',
    'reviewed_by',
    'reviewed_at',
    'review_note',
    'ai_code',
    'ai_confidence'
  ]
  const textHeaders = new Set([
    ...fields,
    ...supports,
    'close_reason',
    'a_labeller',
    'a_username',
    'a_label',
    'b_labeller',
    'b_username',
    'b_label',
    'final_label',
    'reviewed_by',
    'review_note'
  ])
  const columns: CsvColumn[] = headers.map(header => ({ header, text: textHeaders.has(header) }))

  const iterator = pages(where, args => scoped(scope, () => readPairRecords(args, rounds)))
  let records = 0

  const rowsOf = async (batch: PairRecord[]) => {
    const pairs = batch.flatMap(r => pairsOf(r, analysis, keyOf))
    const deepest = (labels: Label[]) => labels[labels.length - 1]
    const labelOf = await nodeLabels(
      scope,
      pairs.flatMap(p => [
        ...[deepest(p.a.labels), deepest(p.b.labels)]
          .filter((l): l is Label => Boolean(l))
          .map(l => ({ taxonomyId: p.taxonomyId, code: l.nodeCode })),
        ...(p.outcome.resultCodes.length > 0 ? [{ taxonomyId: p.taxonomyId, code: p.outcome.resultCodes.at(-1)! }] : [])
      ])
    )
    return pairs.map(pair => {
      const { record: s, round, outcome } = pair
      const text = (prefix: 'field' | 'support', header: string) => {
        const mapping = ((prefix === 'field' ? s.fieldMapping : s.supportMapping) ?? {}) as Record<string, string>
        const slot = Object.entries(mapping).find(([i, name]) => `${prefix}_${name || `${prefix}${i}`}` === header)?.[0]
        return slot ? ((s[`${prefix}${slot}` as keyof typeof s] as string | null) ?? '') : ''
      }
      const codes = (labels: Label[]) => labels.map(l => l.nodeCode)
      const a = codes(pair.a.labels)
      const b = codes(pair.b.labels)
      const compared = outcome.comparedAt !== null
      const sideCells = (x: Pair['a']) => {
        const last = deepest(x.labels)
        return [
          x.task?.assignee?.name ?? '',
          x.task?.assignee?.username ?? '',
          x.task ? String(x.task.fromBaseline) : '',
          last ? last.createdAt.toISOString() : '',
          secondsSpent(x.labels[0]),
          ...levels.map(l => x.labels.find(y => y.level === l)?.nodeCode ?? ''),
          last ? (labelOf.get(`${pair.taxonomyId}:${last.nodeCode}`) ?? '') : '',
          x.revised ? 'true' : 'false'
        ]
      }
      const ai = s.aiSuggestions.filter(x => x.taxonomyId === pair.taxonomyId).sort((x, y) => y.level - x.level)[0]
      const result = outcome.resultCodes
      const differs = compared ? firstDifferingLevel(pair.a.labels, pair.b.labels) : null
      return [
        s.recordKey,
        ...fields.map(h => text('field', h)),
        ...supports.map(h => text('support', h)),
        keyOf.get(pair.taxonomyId) ?? '',
        round.id,
        round.status,
        round.createdAt.toISOString(),
        round.closedAt ? round.closedAt.toISOString() : '',
        round.closeReason ?? '',
        ...sideCells(pair.a),
        ...sideCells(pair.b),
        ...levels.map(l => {
          const x = a[l - 1]
          const y = b[l - 1]
          return !compared || (x === undefined && y === undefined) ? '' : String(x === y)
        }),
        compared ? String(agreedDepth(a, b)) : '',
        differs === null ? '' : String(differs),
        outcome.matched === null ? '' : String(outcome.matched),
        outcome.comparedAt ? outcome.comparedAt.toISOString() : '',
        ...levels.map(l => result[l - 1] ?? ''),
        result.length > 0 ? (labelOf.get(`${pair.taxonomyId}:${result.at(-1)}`) ?? '') : '',
        finalSource(pair),
        outcome.state,
        outcome.reviewedBy?.name ?? '',
        outcome.reviewedAt ? outcome.reviewedAt.toISOString() : '',
        outcome.note ?? '',
        ai?.nodeCode ?? '',
        ai ? ai.confidenceScore.toFixed(4) : ''
      ]
    })
  }

  return streamOf(
    csvLine(columns, headers, { neutralizeFormulas: false }),
    async () => {
      const next = await iterator.next()
      if (next.done) return null
      records += next.value.length
      const rows = await rowsOf(next.value)
      return rows.map(row => '\n' + csvLine(columns, row, opts)).join('')
    },
    opts,
    () => records,
    () => iterator.return(undefined)
  )
}

const AGREEMENT_HEADERS = [
  'section',
  'taxonomy',
  'level',
  'labeller',
  'labeller_b',
  'code_a',
  'label_a',
  'code_b',
  'label_b',
  'compared',
  'agreed',
  'share',
  'decided',
  'chosen_by_reviewer'
]
const AGREEMENT_COLUMNS: CsvColumn[] = AGREEMENT_HEADERS.map(header => ({
  header,
  text: ['labeller', 'labeller_b', 'label_a', 'label_b'].includes(header)
}))

/** The agreement summary CSV (sections: level, pair, labeller, confusion). */
export async function agreementStream(
  scope: ExportScope,
  filter: Prisma.SentenceWhereInput,
  analysis: AnalysisFilter,
  opts: StreamOpts
): Promise<ReadableStream<Uint8Array>> {
  const rounds = roundWhere(analysis)
  const where = { ...filter, workspaceId: scope.workspaceId, doubleRounds: { some: rounds } }
  const { keyOf, depthOf } = await taxonomyKeys(scope)
  const iterator = pages(where, args => scoped(scope, () => readPairRecords(args, rounds)))
  let records = 0
  let finished = false

  const byLevel = new Map<string, { compared: number; agreed: number[]; full: number }>()
  const byPair = new Map<string, { taxonomyId: string; a: string; b: string; compared: number; agreed: number }>()
  const byLabeller = new Map<
    string,
    { taxonomyId: string; name: string; compared: number; agreed: number; decided: number; chosen: number }
  >()
  const confusions = new Map<string, { taxonomyId: string; level: number; a: string; b: string; count: number }>()

  const add = (pair: Pair) => {
    const { outcome } = pair
    if (outcome.comparedAt === null || outcome.matched === null) return
    const a = pair.a.labels.map(l => l.nodeCode)
    const b = pair.b.labels.map(l => l.nodeCode)
    const t = pair.taxonomyId
    const level = byLevel.get(t) ?? { compared: 0, agreed: Array(MAX_LEVELS).fill(0), full: 0 }
    level.compared++
    // Identical paths agree at every level, also when they end early (e.g. unknown at level 1).
    const depth = sameCodes(a, b) ? MAX_LEVELS : agreedDepth(a, b)
    for (let l = 0; l < depth; l++) level.agreed[l]++
    if (outcome.matched) level.full++
    byLevel.set(t, level)

    const nameA = pair.a.task?.assignee?.name ?? 'Former member'
    const nameB = pair.b.task?.assignee?.name ?? 'Former member'
    const [x, y] = [nameA, nameB].sort()
    const pairKey = `${t}\u0001${x}\u0001${y}`
    const p = byPair.get(pairKey) ?? { taxonomyId: t, a: x!, b: y!, compared: 0, agreed: 0 }
    p.compared++
    if (outcome.matched) p.agreed++
    byPair.set(pairKey, p)

    const decided = outcome.state === 'reviewed' && outcome.resultCodes.length > 0
    for (const [name, codes] of [
      [nameA, a],
      [nameB, b]
    ] as const) {
      const key = `${t}\u0001${name}`
      const entry = byLabeller.get(key) ?? { taxonomyId: t, name, compared: 0, agreed: 0, decided: 0, chosen: 0 }
      entry.compared++
      if (outcome.matched) entry.agreed++
      if (decided) {
        entry.decided++
        if (sameCodes(outcome.resultCodes, codes)) entry.chosen++
      }
      byLabeller.set(key, entry)
    }

    if (!outcome.matched) {
      const at = firstDifferingLevel(pair.a.labels, pair.b.labels)
      if (at !== null) {
        const [ca, cb] = [a[at - 1] ?? '', b[at - 1] ?? ''].sort()
        const key = `${t}\u0001${at}\u0001${ca}\u0001${cb}`
        const c = confusions.get(key) ?? { taxonomyId: t, level: at, a: ca!, b: cb!, count: 0 }
        c.count++
        confusions.set(key, c)
      }
    }
  }

  const share = (agreed: number, compared: number) => (compared > 0 ? (agreed / compared).toFixed(4) : '')
  const summary = async () => {
    const key = (t: string) => keyOf.get(t) ?? ''
    const rows: Array<Array<string | number>> = []
    const blank = (n: number) => Array<string>(n).fill('')
    for (const [t, l] of [...byLevel].sort((x, y) => key(x[0]).localeCompare(key(y[0])))) {
      l.agreed.slice(0, depthOf.get(t) ?? MAX_LEVELS).forEach((agreed, i) => {
        rows.push(['level', key(t), i + 1, ...blank(6), l.compared, agreed, share(agreed, l.compared), '', ''])
      })
      rows.push(['level', key(t), 'full', ...blank(6), l.compared, l.full, share(l.full, l.compared), '', ''])
    }
    for (const p of [...byPair.values()].sort((x, y) => y.compared - x.compared)) {
      rows.push([
        'pair',
        key(p.taxonomyId),
        'full',
        p.a,
        p.b,
        ...blank(4),
        p.compared,
        p.agreed,
        share(p.agreed, p.compared),
        '',
        ''
      ])
    }
    for (const e of [...byLabeller.values()].sort((x, y) => x.name.localeCompare(y.name))) {
      rows.push([
        'labeller',
        key(e.taxonomyId),
        'full',
        e.name,
        ...blank(5),
        e.compared,
        e.agreed,
        share(e.agreed, e.compared),
        e.decided,
        e.chosen
      ])
    }
    const sorted = [...confusions.values()].sort((x, y) => y.count - x.count)
    const labels = await nodeLabels(
      scope,
      sorted.flatMap(c => [
        { taxonomyId: c.taxonomyId, code: c.a },
        { taxonomyId: c.taxonomyId, code: c.b }
      ])
    )
    for (const c of sorted) {
      rows.push([
        'confusion',
        key(c.taxonomyId),
        c.level,
        '',
        '',
        c.a,
        labels.get(`${c.taxonomyId}:${c.a}`) ?? '',
        c.b,
        labels.get(`${c.taxonomyId}:${c.b}`) ?? '',
        c.count,
        '',
        '',
        '',
        ''
      ])
    }
    return rows.map(row => '\n' + csvLine(AGREEMENT_COLUMNS, row.map(String), opts)).join('')
  }

  return streamOf(
    csvLine(AGREEMENT_COLUMNS, AGREEMENT_HEADERS, { neutralizeFormulas: false }),
    async () => {
      if (finished) return null
      // Collect page by page; the summary goes out once every page is read.
      while (true) {
        const next = await iterator.next()
        if (next.done) break
        records += next.value.length
        next.value.flatMap(r => pairsOf(r, analysis, keyOf)).forEach(add)
      }
      finished = true
      return summary()
    },
    opts,
    () => records,
    () => iterator.return(undefined)
  )
}

/** Counts for the export page: records, and double annotation rounds and pairs. */
export async function exportSummary(workspaceId: string) {
  const [records, rounds, pairs, compared] = await Promise.all([
    db().sentence.count(),
    db().doubleRound.count(),
    db().doubleOutcome.count(),
    db().doubleOutcome.count({ where: { comparedAt: { not: null } } })
  ])
  return { workspaceId, records, rounds, pairs, compared }
}
