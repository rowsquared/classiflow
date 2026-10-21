import { parse } from 'csv-parse/sync'
import { passwordProblem } from '@/lib/password-policy'

/**
 * CSV member import (U4): parsing and the checks that need no database. Pure,
 * unit tested in member-import.test.ts. The route adds the database checks
 * (existing usernames/emails, supervisors who are already members) and
 * creates everything in one transaction.
 *
 * Every header is required; unknown and duplicate headers are errors, so a
 * misspelled column never vanishes silently. All row errors are reported with
 * their line in the file (quoted multi-line cells counted correctly).
 */

export const MEMBER_IMPORT_MAX_ROWS = 500
export const MEMBER_IMPORT_MAX_BYTES = 1024 * 1024

export const MEMBER_IMPORT_COLUMNS = ['username', 'email', 'name', 'role', 'supervisor', 'access', 'password'] as const

export const MEMBER_IMPORT_TEMPLATE =
  MEMBER_IMPORT_COLUMNS.join(',') +
  '\n' +
  'maria,maria@example.org,Maria Rossi,supervisor,,invite,\n' +
  'ahmed,ahmed@example.org,Ahmed Ali,labeller,maria,email_password,\n' +
  'wei,wei@example.org,Li Wei,labeller,maria,generate,\n'

/**
 * invite: a link to choose a password (mail). email_password: a generated
 * temporary password by mail. generate: a generated temporary password shown
 * once to the admin. password: the `password` column.
 */
export type ImportAccess = 'invite' | 'email_password' | 'generate' | 'password'
const ACCESS = new Set<ImportAccess>(['invite', 'email_password', 'generate', 'password'])
const ROLES = new Set(['admin', 'supervisor', 'labeller'])
const USERNAME = /^[a-zA-Z0-9_.-]{3,100}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportRow = {
  line: number
  username: string
  displayUsername: string
  email: string
  name: string
  role: 'admin' | 'supervisor' | 'labeller'
  /** Lower-case username of the supervisor (a member, or a row of this file). */
  supervisor: string | null
  access: ImportAccess
  password: string | null
}

export type RowError = { line: number; field: string; message: string }

export type ParsedImport = {
  rows: ImportRow[]
  errors: RowError[]
  /** File-level problems (headers, size, parse errors); nothing else is checked then. */
  fileErrors: string[]
}

export function parseMemberCsv(text: string, opts: { mailEnabled: boolean }): ParsedImport {
  const fileErrors: string[] = []
  if (Buffer.byteLength(text, 'utf8') > MEMBER_IMPORT_MAX_BYTES) {
    return { rows: [], errors: [], fileErrors: ['The file is larger than 1 MB'] }
  }
  let records: Array<{ record: string[]; info: { lines: number } }>
  try {
    // CRLF to LF first: csv-parse counts both characters of a CRLF inside a
    // quoted cell as line breaks, which would shift the reported lines.
    records = parse(text.replace(/\r\n/g, '\n'), {
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: false
    }) as unknown as typeof records
  } catch (caught) {
    return { rows: [], errors: [], fileErrors: [`The file is not valid CSV: ${(caught as Error).message}`] }
  }
  const [header, ...body] = records
  if (!header) return { rows: [], errors: [], fileErrors: ['The file is empty'] }

  const headers = header.record.map(h => h.trim().toLowerCase())
  const duplicates = headers.filter((h, i) => headers.indexOf(h) !== i)
  const unknown = headers.filter(h => !(MEMBER_IMPORT_COLUMNS as readonly string[]).includes(h))
  const missing = MEMBER_IMPORT_COLUMNS.filter(c => !headers.includes(c))
  if (duplicates.length) fileErrors.push(`Duplicate columns: ${[...new Set(duplicates)].join(', ')}`)
  if (unknown.length) fileErrors.push(`Unknown columns: ${unknown.join(', ')}`)
  if (missing.length) fileErrors.push(`Missing columns: ${missing.join(', ')}`)
  if (fileErrors.length) return { rows: [], errors: [], fileErrors }

  const nonBlank = body.filter(r => r.record.some(cell => cell.trim() !== ''))
  if (nonBlank.length === 0) return { rows: [], errors: [], fileErrors: ['The file has no members'] }
  if (nonBlank.length > MEMBER_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [], fileErrors: [`At most ${MEMBER_IMPORT_MAX_ROWS} members per file`] }
  }

  const errors: RowError[] = []
  const rows: ImportRow[] = []
  for (const { record, info } of nonBlank) {
    // info.lines is the line where the record ends; count back for multi-line cells.
    const line = info.lines - (record.join(',').split('\n').length - 1)
    const cell = (column: (typeof MEMBER_IMPORT_COLUMNS)[number]) => record[headers.indexOf(column)] ?? ''
    const add = (field: string, message: string) => errors.push({ line, field, message })

    const displayUsername = cell('username').trim()
    const email = cell('email').trim().toLowerCase()
    const name = cell('name').trim()
    const role = cell('role').trim().toLowerCase()
    const supervisor = cell('supervisor').trim().toLowerCase() || null
    const access = cell('access').trim().toLowerCase() as ImportAccess
    // Passwords are never trimmed.
    const password = cell('password')

    if (!displayUsername) add('username', 'Username is required')
    else if (!USERNAME.test(displayUsername)) {
      add('username', '3 to 100 letters, digits, dot, underscore or hyphen')
    }
    if (!email) add('email', 'Email is required')
    else if (email.length > 254 || !EMAIL.test(email)) add('email', 'Not a valid email address')
    if (!name) add('name', 'Name is required')
    else if (name.length > 200) add('name', 'At most 200 characters')
    if (!ROLES.has(role)) add('role', 'Use labeller, supervisor or admin')
    if (!ACCESS.has(access)) add('access', 'Use invite, email_password, generate or password')
    else if ((access === 'invite' || access === 'email_password') && !opts.mailEnabled) {
      add('access', `"${access}" needs email, which is not configured`)
    }
    if (access === 'password') {
      const problem = password ? passwordProblem(password, { username: displayUsername, email, name }) : null
      if (!password) add('password', 'Password is required for access "password"')
      else if (problem) add('password', problem)
    } else if (password) {
      add('password', 'Leave the password empty unless access is "password"')
    }
    if (supervisor && supervisor === displayUsername.toLowerCase()) {
      add('supervisor', 'A member cannot supervise themselves')
    }

    rows.push({
      line,
      username: displayUsername.toLowerCase(),
      displayUsername,
      email,
      name,
      role: role as ImportRow['role'],
      supervisor,
      access,
      password: access === 'password' ? password : null
    })
  }

  // In-file collisions reject every row involved, not just the later ones.
  for (const key of ['username', 'email'] as const) {
    const counts = new Map<string, number>()
    for (const row of rows) if (row[key]) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1)
    for (const row of rows) {
      if (row[key] && (counts.get(row[key]) ?? 0) > 1) {
        errors.push({ line: row.line, field: key, message: `This ${key} appears more than once in the file` })
      }
    }
  }

  // Supervisors named in the file must be admins or supervisors there; no cycles.
  const byUsername = new Map(rows.map(r => [r.username, r]))
  for (const row of rows) {
    const target = row.supervisor ? byUsername.get(row.supervisor) : undefined
    if (target && target.role === 'labeller') {
      errors.push({ line: row.line, field: 'supervisor', message: 'The supervisor must be an admin or supervisor' })
    }
  }
  for (const row of rows) {
    const seen = new Set<string>([row.username])
    let next = row.supervisor ? byUsername.get(row.supervisor) : undefined
    while (next) {
      if (seen.has(next.username)) {
        errors.push({ line: row.line, field: 'supervisor', message: 'The supervisors in this file form a cycle' })
        break
      }
      seen.add(next.username)
      next = next.supervisor ? byUsername.get(next.supervisor) : undefined
    }
  }

  errors.sort((a, b) => a.line - b.line)
  return { rows, errors, fileErrors: [] }
}

/** Rows ordered so that every in-file supervisor comes before their reports. */
export function creationOrder(rows: ImportRow[]): ImportRow[] {
  const byUsername = new Map(rows.map(r => [r.username, r]))
  const done = new Set<string>()
  const ordered: ImportRow[] = []
  const visit = (row: ImportRow, depth = 0) => {
    if (done.has(row.username) || depth > rows.length) return
    const parent = row.supervisor ? byUsername.get(row.supervisor) : undefined
    if (parent) visit(parent, depth + 1)
    done.add(row.username)
    ordered.push(row)
  }
  rows.forEach(row => visit(row))
  return ordered
}
