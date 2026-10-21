import {
  createLoader,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType
} from 'nuqs/server'

// The queue's view lives in the URL (nuqs), so back/forward and shared links
// reproduce it, and the server page renders the same view the client then
// keeps up to date. Filter parameters use the names the queue API parses
// (queueWhere in lib/server/sentences.ts); `tab` is the status tab and
// `status` the filter panel's statuses, which only apply on the "All" tab.

export const QUEUE_TABS = ['all', 'pending', 'submitted', 'skipped'] as const
export type QueueTab = (typeof QUEUE_TABS)[number]

export const queueFilterParsers = {
  status: parseAsArrayOf(parseAsString).withDefault([]),
  assignedToUserId: parseAsString,
  lastEditorId: parseAsString,
  lastEditedFrom: parseAsString,
  lastEditedTo: parseAsString,
  taxonomyKey: parseAsString,
  level: parseAsString,
  code: parseAsString,
  source: parseAsString,
  aiTaxonomyKey: parseAsString,
  aiLevel: parseAsString,
  aiCode: parseAsString,
  aiConfidenceMin: parseAsString,
  aiConfidenceMax: parseAsString,
  flagged: parseAsBoolean,
  hasComments: parseAsBoolean,
  hasSubmittedLabels: parseAsBoolean,
  hasAISuggestions: parseAsBoolean,
  importId: parseAsString
}

export const queueParsers = {
  q: parseAsString.withDefault(''),
  tab: parseAsStringLiteral(QUEUE_TABS).withDefault('pending'),
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(100),
  ...queueFilterParsers
}

export type QueueFilterValues = inferParserType<typeof queueFilterParsers>
export type QueueUrlState = inferParserType<typeof queueParsers>

/** Reads the queue state from a page's searchParams (server) or a URLSearchParams. */
export const loadQueueUrlState = createLoader(queueParsers)

export const EMPTY_QUEUE_FILTERS: QueueFilterValues = {
  status: [],
  assignedToUserId: null,
  lastEditorId: null,
  lastEditedFrom: null,
  lastEditedTo: null,
  taxonomyKey: null,
  level: null,
  code: null,
  source: null,
  aiTaxonomyKey: null,
  aiLevel: null,
  aiCode: null,
  aiConfidenceMin: null,
  aiConfidenceMax: null,
  flagged: null,
  hasComments: null,
  hasSubmittedLabels: null,
  hasAISuggestions: null,
  importId: null
}

/** Only the filter-panel values of a queue state. */
export function pickQueueFilters(state: QueueFilterValues): QueueFilterValues {
  return Object.fromEntries(
    Object.keys(EMPTY_QUEUE_FILTERS).map(key => [key, state[key as keyof QueueFilterValues]])
  ) as QueueFilterValues
}

/** How many filter groups are set (the badge on the filter button). */
export function countActiveFilters(f: QueueFilterValues): number {
  return [
    f.flagged !== null,
    f.hasComments !== null,
    Boolean(f.assignedToUserId),
    Boolean(f.lastEditorId),
    Boolean(f.lastEditedFrom || f.lastEditedTo),
    Boolean(f.taxonomyKey),
    Boolean(f.code),
    Boolean(f.aiTaxonomyKey),
    Boolean(f.aiCode),
    f.aiConfidenceMin !== null,
    f.aiConfidenceMax !== null,
    f.hasSubmittedLabels !== null,
    f.hasAISuggestions !== null,
    Boolean(f.importId),
    f.status.length > 0
  ].filter(Boolean).length
}

function appendFilters(params: URLSearchParams, f: QueueFilterValues) {
  const strings = [
    'assignedToUserId',
    'lastEditorId',
    'lastEditedFrom',
    'lastEditedTo',
    'taxonomyKey',
    'level',
    'code',
    'source',
    'aiTaxonomyKey',
    'aiLevel',
    'aiCode',
    'aiConfidenceMin',
    'aiConfidenceMax'
  ] as const
  for (const key of strings) {
    const value = f[key]
    if (value) params.set(key, value)
  }
  const booleans = ['hasSubmittedLabels', 'hasAISuggestions', 'flagged', 'hasComments'] as const
  for (const key of booleans) {
    const value = f[key]
    if (value !== null) params.set(key, String(value))
  }
  if (f.importId) params.set('importId', f.importId)
}

/**
 * Parameters of `GET /sentences` for this view. The tab decides the status;
 * the filter panel's statuses only apply on the "All" tab. Deterministic, so
 * the string can be part of a query key.
 */
export function queueListParams(state: QueueUrlState): string {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.tab !== 'all') params.set('status', state.tab)
  else if (state.status.length > 0) params.set('status', state.status.join(','))
  appendFilters(params, state)
  params.set('page', String(Math.max(1, state.page)))
  params.set('limit', String(state.limit))
  params.set('sort', 'createdAt')
  params.set('order', 'asc')
  return params.toString()
}

/** Parameters of `GET /sentences/stats`: the same filters, all tabs (the tab counts). */
export function queueStatsParams(state: QueueUrlState): string {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.status.length > 0) params.set('status', state.status.join(','))
  appendFilters(params, state)
  return params.toString()
}
