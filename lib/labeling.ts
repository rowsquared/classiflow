import { getUnknownCodeForLevel, isUnknownNodeCode } from '@/lib/constants'

// Pure rules of the labelling screen and the taxonomy browser (no React), so
// they are unit tested: which labels a record shows, when it can be submitted,
// and which level the browser opens.

export type SelectedLabel = {
  level: number
  nodeCode: string
  taxonomyKey: string
  label?: string
  definition?: string
  examples?: string
  isLeaf?: boolean
  source?: 'user' | 'ai'
  confidenceScore?: number
}

export type RecordAnnotation = {
  level: number
  nodeCode: string
  nodeLabel?: string
  nodeDefinition?: string | null
  isLeaf?: boolean
  taxonomy: { key: string }
  source?: 'user' | 'ai'
  confidenceScore?: number
}

/** The record's labels (human ones, or else the AI suggestion) for one taxonomy, as browser selections. */
export function labelsFromAnnotations(annotations: RecordAnnotation[], taxonomyKey: string): SelectedLabel[] {
  return annotations
    .filter(ann => ann.taxonomy.key === taxonomyKey)
    .map(ann => ({
      level: ann.level,
      nodeCode: ann.nodeCode,
      taxonomyKey: ann.taxonomy.key,
      label: ann.nodeLabel || '',
      definition: ann.nodeDefinition || undefined,
      isLeaf: ann.isLeaf || false,
      source: ann.source || 'user',
      confidenceScore: ann.confidenceScore
    }))
}

/**
 * Taxonomies with human labels on this record. AI suggestions never count:
 * otherwise Submit would read "submitted" before anyone labelled.
 */
export function completedTaxonomyKeys(annotations: RecordAnnotation[], taxonomyKeys: string[]): Set<string> {
  return new Set(
    taxonomyKeys.filter(key => annotations.some(ann => ann.taxonomy?.key === key && (ann.source ?? 'user') !== 'ai'))
  )
}

/**
 * A selection can be submitted when it ends in a leaf or an unknown code, or
 * when it is a complete AI suggestion (levels 1..n without gaps) whose deepest
 * label is a leaf, unknown, or at the taxonomy's maximum depth.
 */
export function canSubmitLabels(labels: SelectedLabel[], maxDepth: number | undefined): boolean {
  if (labels.some(l => l.isLeaf === true || isUnknownNodeCode(l.nodeCode))) return true
  const ai = labels.filter(l => l.source === 'ai')
  if (ai.length === 0) return false
  const levels = ai.map(l => l.level)
  const deepest = Math.max(...levels)
  for (let level = 1; level <= deepest; level++) if (!levels.includes(level)) return false
  const lowest = ai.find(l => l.level === deepest)
  return (
    lowest !== undefined &&
    (lowest.isLeaf === true ||
      isUnknownNodeCode(lowest.nodeCode) ||
      lowest.level >= (maxDepth || Number.MAX_SAFE_INTEGER))
  )
}

/** "Unknown" at `level`, keeping the chosen labels above it. */
export function withUnknownAt(labels: SelectedLabel[], taxonomyKey: string, level: number): SelectedLabel[] {
  return [
    ...labels.filter(l => l.taxonomyKey === taxonomyKey && l.level < level),
    { level, nodeCode: getUnknownCodeForLevel(level), taxonomyKey, label: 'Unknown', isLeaf: true }
  ]
}

/** Identity of a selection; changes whenever the chosen path changes. */
export function labelsSignature(labels: SelectedLabel[]): string {
  return JSON.stringify(
    labels
      .map(l => ({ level: l.level, code: l.nodeCode, taxonomy: l.taxonomyKey, isLeaf: l.isLeaf }))
      .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))
  )
}

/**
 * The level the browser shows for a selection: the children of the deepest
 * label, or that label's own level when it is a leaf (or at maximum depth).
 */
export function positionForLabels(
  labels: SelectedLabel[],
  maxDepth: number | undefined
): { level: number; parent: string | null } {
  const sorted = [...labels].sort((a, b) => a.level - b.level)
  const last = sorted.at(-1)
  if (!last) return { level: 1, parent: null }
  const prev = sorted.at(-2)
  const isLeaf = Boolean(last.isLeaf) || last.level >= (maxDepth || Number.MAX_SAFE_INTEGER)
  if (isLeaf) return { level: last.level, parent: prev ? prev.nodeCode : null }
  return { level: Math.min(last.level + 1, maxDepth || last.level + 1), parent: last.nodeCode }
}

/** The AI-suggested labels of a selection, top level first; null when there are none. */
export function aiSuggestionPath(labels: SelectedLabel[]): SelectedLabel[] | null {
  const ai = labels.filter(l => l.source === 'ai')
  return ai.length > 0 ? [...ai].sort((a, b) => a.level - b.level).map(l => ({ ...l })) : null
}

/** Whether two selections choose the same codes at the same levels. */
export function sameLabelPath(a: SelectedLabel[] | null, b: SelectedLabel[] | null): boolean {
  if (!a || !b) return false
  const norm = (labels: SelectedLabel[]) =>
    labels
      .filter(l => l.level > 0)
      .sort((x, y) => x.level - y.level)
      .map(l => `${l.level}:${l.nodeCode}`)
  const [x, y] = [norm([...a]), norm([...b])]
  return x.length === y.length && x.every((entry, i) => entry === y[i])
}
