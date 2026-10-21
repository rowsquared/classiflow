import { parse } from 'csv-parse/sync'
import { isUnknownNodeCode } from '@/lib/constants'

/**
 * Taxonomy CSV parsing and validation, shared by validate, create, replace
 * (PUT with a file) and incremental import, so a file that passes the dry run
 * is exactly what gets committed.
 *
 * Columns: id, label, parent_id, level (required); definition, examples,
 * synonyms (optional; synonyms separated by , ; or |). Codes stay strings:
 * no casting, leading zeros are kept.
 *
 * Rules: unique non-empty ids that are not reserved unknown codes; non-empty
 * labels; level an integer 1..maxDepth; level 1 has no parent; every other row's
 * parent exists (in the file, or among `existingNodes` for incremental imports)
 * and sits exactly one level up, which also rules out cycles.
 */

export const REQUIRED_HEADERS = ['id', 'label', 'parent_id', 'level'] as const
export const OPTIONAL_HEADERS = ['definition', 'examples', 'synonyms'] as const
const ALLOWED_HEADERS = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS])

const MAX_LEVELS = 5
const MAX_CODE_LENGTH = 100
const MAX_ERRORS = 200

export type TaxonomyCsvNode = {
  code: string
  label: string
  level: number
  parentCode: string | null
  definition: string | null
  examples: string | null
  synonyms: string[]
  isLeaf: boolean
  path: string
}

export type CsvError = { row: number; message: string }

export type ParseResult = { nodes: TaxonomyCsvNode[]; errors: CsvError[] }

type Options = {
  maxDepth?: number
  /** Incremental import: nodes already in the taxonomy (code -> level). */
  existingNodes?: Map<string, number>
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())

export function parseTaxonomyCsv(csv: string, opts: Options = {}): ParseResult {
  const errors: CsvError[] = []
  const fail = (row: number, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ row, message })
  }
  const maxDepth = Math.min(opts.maxDepth || MAX_LEVELS, MAX_LEVELS)
  const existing = opts.existingNodes ?? new Map<string, number>()

  let records: Record<string, string>[]
  let headers: string[] = []
  try {
    records = parse(csv, {
      columns: (header: string[]) => {
        headers = header.map(h => String(h).trim())
        return headers
      },
      skip_empty_lines: true,
      bom: true,
      cast: false
    }) as Record<string, string>[]
  } catch (caught) {
    return { nodes: [], errors: [{ row: 0, message: `CSV parsing error: ${(caught as Error).message}` }] }
  }

  const duplicateHeaders = headers.filter((h, i) => headers.indexOf(h) !== i)
  if (duplicateHeaders.length > 0) {
    return {
      nodes: [],
      errors: [{ row: 1, message: `Duplicate columns: ${Array.from(new Set(duplicateHeaders)).join(', ')}` }]
    }
  }
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h))
  if (missing.length > 0) {
    return {
      nodes: [],
      errors: [
        {
          row: 1,
          message: `Missing required columns: ${missing.join(', ')}. The CSV must contain: id, label, parent_id, and level.`
        }
      ]
    }
  }
  const disallowed = headers.filter(h => !ALLOWED_HEADERS.has(h))
  if (disallowed.length > 0) {
    return {
      nodes: [],
      errors: [
        {
          row: 1,
          message: `Disallowed columns: ${disallowed.join(', ')}. Allowed: ${Array.from(ALLOWED_HEADERS).join(', ')}.`
        }
      ]
    }
  }
  if (records.length === 0) {
    return { nodes: [], errors: [{ row: 0, message: 'CSV file is empty or contains no data rows' }] }
  }

  // Pass 1: row-local checks and the id index.
  type Row = {
    rowNum: number
    code: string
    label: string
    level: number
    parentCode: string | null
    record: Record<string, string>
  }
  const rows: Row[] = []
  const firstRowOf = new Map<string, number>()
  records.forEach((record, idx) => {
    const rowNum = idx + 2 // header is row 1
    const code = text(record.id)
    const label = text(record.label)
    const parentCode = text(record.parent_id) || null
    const levelText = text(record.level)
    const level = /^\d+$/.test(levelText) ? parseInt(levelText, 10) : NaN

    let ok = true
    if (!code) {
      fail(rowNum, 'Empty id value')
      ok = false
    } else if (code.length > MAX_CODE_LENGTH) {
      fail(rowNum, `id is longer than ${MAX_CODE_LENGTH} characters`)
      ok = false
    } else if (isUnknownNodeCode(code)) {
      fail(rowNum, `Code ${code} is reserved for UNKNOWN labels and cannot be used`)
      ok = false
    }
    if (!label) {
      fail(rowNum, 'Empty label value')
      ok = false
    }
    if (!Number.isInteger(level) || level < 1 || level > maxDepth) {
      fail(rowNum, `level must be a whole number from 1 to ${maxDepth} (got "${levelText}")`)
      ok = false
    }
    if (parentCode && isUnknownNodeCode(parentCode)) {
      fail(rowNum, `Code ${parentCode} is reserved for UNKNOWN labels and cannot be used as parent_id`)
      ok = false
    }
    if (code) {
      if (firstRowOf.has(code)) {
        fail(rowNum, `Duplicate id "${code}" (also appears in row ${firstRowOf.get(code)})`)
        ok = false
      } else {
        firstRowOf.set(code, rowNum)
      }
      if (existing.has(code)) {
        fail(rowNum, `id "${code}" already exists in this taxonomy`)
        ok = false
      }
    }
    if (ok) rows.push({ rowNum, code, label, level, parentCode, record })
  })

  // Pass 2: hierarchy.
  const levelOf = new Map<string, number>(existing)
  rows.forEach(r => levelOf.set(r.code, r.level))
  const parentOf = new Map<string, string | null>(rows.map(r => [r.code, r.parentCode]))
  const hasChildren = new Set<string>()
  for (const r of rows) {
    if (r.level === 1) {
      if (r.parentCode) fail(r.rowNum, 'level 1 rows must have an empty parent_id')
      continue
    }
    if (!r.parentCode) {
      fail(r.rowNum, `level ${r.level} rows need a parent_id`)
      continue
    }
    const parentLevel = levelOf.get(r.parentCode)
    if (parentLevel === undefined) {
      fail(
        r.rowNum,
        `parent_id "${r.parentCode}" does not match any id ${existing.size > 0 ? 'in the file or the taxonomy' : 'in the file'}`
      )
      continue
    }
    if (parentLevel !== r.level - 1) {
      fail(
        r.rowNum,
        `parent_id "${r.parentCode}" is at level ${parentLevel}; a level ${r.level} row needs a level ${r.level - 1} parent`
      )
      continue
    }
    hasChildren.add(r.parentCode)
  }

  if (errors.length > 0) return { nodes: [], errors }

  const pathOf = (code: string): string => {
    const parts = [code]
    let cur = parentOf.get(code) ?? null
    while (cur) {
      parts.unshift(cur)
      cur = parentOf.get(cur) ?? null
    }
    return parts.join('.')
  }

  const nodes = rows.map(r => ({
    code: r.code,
    label: r.label,
    level: r.level,
    parentCode: r.parentCode,
    definition: text(r.record.definition) || null,
    examples: text(r.record.examples) || null,
    synonyms: Array.from(
      new Set(
        text(r.record.synonyms)
          .split(/[,;|]/)
          .map(s => s.trim())
          .filter(Boolean)
      )
    ),
    isLeaf: !hasChildren.has(r.code),
    path: pathOf(r.code)
  }))
  return { nodes, errors: [] }
}

/** Human-readable summary used by the routes' `error` field. */
export function formatCsvErrors(errors: CsvError[]): string {
  return `Validation failed:\n${errors.map(e => (e.row ? `Row ${e.row}: ${e.message}` : e.message)).join('\n')}`
}
