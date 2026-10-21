import type { CsvRow } from '@/lib/utils'

// Pure helpers for the taxonomy administration screen
// (components/taxonomy-admin/), kept here so they can be unit tested.

export type RowError = { row: number; message: string }

export type TaxonomyAIStatus = {
  lastAISyncStatus?: string | null
  lastLearningStatus?: string | null
}

const ACTIVE = new Set(['pending', 'processing'])

/** Whether a sync or learning job of any of these taxonomies is still running (the list then polls). */
export function hasActiveAIJobs(taxonomies: TaxonomyAIStatus[]): boolean {
  return taxonomies.some(t => ACTIVE.has(t.lastAISyncStatus ?? '') || ACTIVE.has(t.lastLearningStatus ?? ''))
}

/** The server's message followed by at most `limit` row errors, as shown in the dialogs. */
export function formatImportErrors(error: string, errors: unknown, limit = 20): string {
  if (!Array.isArray(errors) || errors.length === 0) return error
  const list = (errors as RowError[])
    .slice(0, limit)
    .map(e => `Row ${e.row}: ${e.message}`)
    .join('\n')
  const more = errors.length > limit ? `\n... and ${errors.length - limit} more errors` : ''
  return `${error}\n\n${list}${more}`
}

/**
 * The deepest `level` among parsed taxonomy CSV rows, or null when there is
 * none. The dialog parses the file itself (csv-parse, loaded on demand).
 */
export function maxLevelOf(rows: CsvRow[]): number | null {
  let maxLevel = 0
  for (const row of rows) {
    const level = parseInt(String(row.level ?? '').trim(), 10)
    if (!isNaN(level) && level > maxLevel) maxLevel = level
  }
  return maxLevel > 0 ? maxLevel : null
}
