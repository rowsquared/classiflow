/**
 * Format field names from snake_case to Title Case
 * Example: "job_description" -> "Job Description"
 */
export function formatFieldName(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Format date to relative time (e.g., "2h ago", "3d ago")
 */
export function formatRelativeTime(date: string | null): string {
  if (!date) return 'Never'
  
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)
  
  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffWeek < 4) return `${diffWeek}w ago`
  if (diffMonth < 12) return `${diffMonth}mo ago`
  return `${diffYear}y ago`
}

/**
 * Format date to full datetime string
 */
export function formatDateTime(date: string | null): string {
  if (!date) return 'Never'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) {
    return 'Invalid date'
  }
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Format date to date-only string (YYYY-MM-DD)
 */
export function formatDate(date: string | Date | null): string {
  if (!date) return 'Never'
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) {
    return 'Invalid date'
  }
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Narrow a query-string value to one of an enum's values, or undefined. */
export function parseEnum<T extends string>(values: Record<string, T>, raw: string | null | undefined): T | undefined {
  return (Object.values(values) as string[]).includes(raw ?? '') ? (raw as T) : undefined
}

/** What handlers read from a caught value: Error fields plus Prisma's code/meta. */
export type CaughtError = { message?: string; code?: string; meta?: unknown; stack?: string }

/** One row from csv-parse with `columns: true` and `cast: false`. */
export type CsvRow = Record<string, string>
