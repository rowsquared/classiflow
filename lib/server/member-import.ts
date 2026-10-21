import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/generated/prisma/client'
import type { CurrentUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { mailEnabled } from '@/lib/mail/config'
import { deliverSoon, queueCredentialMail, queueMail, sendCredentialMailSoon } from '@/lib/mail/outbox'
import { creationOrder, parseMemberCsv, type ImportRow, type RowError } from '@/lib/member-import'
import { generateTemporaryPassword, hashPassword, setPasswordHash } from '@/lib/passwords'
import { passwordProblem } from '@/lib/password-policy'
import { db, withWorkspace } from '@/lib/workspace/db'

// CSV member import (U4) into one workspace: a dry run that writes and mails
// nothing, then a commit that creates every account and membership in one
// transaction or none. The commit carries a key chosen by the browser; a
// replayed or concurrent commit with the same key returns the stored outcome
// and creates and mails nothing. Mail goes out after the commit: invitation
// links through the outbox, generated passwords from memory (never stored).

export type ImportOutcomeRow = {
  line: number
  username: string
  userId: string | null
  access: string
  mailStatus: string | null
  /** Only for `generate`, only in the commit response. */
  password?: string
}

type Prepared = { rows: ImportRow[]; errors: RowError[]; fileErrors: string[] }

/** Parses the file and adds the checks against this workspace and existing accounts. */
export async function prepareImport(workspaceId: string, text: string): Promise<Prepared> {
  const parsed = parseMemberCsv(text, { mailEnabled: mailEnabled() })
  if (parsed.fileErrors.length) return parsed
  const errors = [
    ...parsed.errors,
    ...(await withWorkspace(workspaceId, () => databaseErrors(workspaceId, parsed.rows)))
  ]
  errors.sort((a, b) => a.line - b.line)
  return { rows: parsed.rows, errors, fileErrors: [] }
}

/**
 * Usernames and emails must be new (the import never updates or adds
 * existing accounts); a supervisor not in the file must be an active admin or
 * supervisor of this workspace. Runs in a workspace transaction.
 */
async function databaseErrors(workspaceId: string, rows: ImportRow[]): Promise<RowError[]> {
  const errors: RowError[] = []
  const taken = await db().user.findMany({
    where: { OR: [{ username: { in: rows.map(r => r.username) } }, { email: { in: rows.map(r => r.email) } }] },
    select: { username: true, email: true }
  })
  const usernames = new Set(taken.map(t => t.username))
  const emails = new Set(taken.map(t => t.email))
  for (const row of rows) {
    if (usernames.has(row.username))
      errors.push({ line: row.line, field: 'username', message: 'Username already in use' })
    if (emails.has(row.email)) errors.push({ line: row.line, field: 'email', message: 'Email already in use' })
  }
  const inFile = new Set(rows.map(r => r.username))
  const outside = [...new Set(rows.map(r => r.supervisor).filter((s): s is string => !!s && !inFile.has(s)))]
  const supervisors = await existingSupervisors(workspaceId, outside)
  for (const row of rows) {
    if (row.supervisor && !inFile.has(row.supervisor) && !supervisors.has(row.supervisor)) {
      errors.push({
        line: row.line,
        field: 'supervisor',
        message: 'No admin or supervisor with this username in this workspace or the file'
      })
    }
  }
  return errors
}

async function existingSupervisors(workspaceId: string, usernames: string[]): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map()
  const rows = await db().workspaceMembership.findMany({
    where: {
      workspaceId,
      status: 'active',
      role: { in: ['admin', 'supervisor'] },
      user: { username: { in: usernames } }
    },
    select: { id: true, user: { select: { username: true } } }
  })
  return new Map(rows.map(r => [r.user.username, r.id]))
}

export function previewRows(rows: ImportRow[]) {
  return rows.map(row => ({
    line: row.line,
    username: row.username,
    displayUsername: row.displayUsername,
    email: row.email,
    name: row.name,
    role: row.role,
    supervisor: row.supervisor,
    access: row.access
  }))
}

/** The stored outcome of a committed import (replays, and the result dialog's polling). */
export async function importOutcome(workspaceId: string, where: { importKey: string } | { id: string }) {
  const found = await withWorkspace(workspaceId, () =>
    db().memberImport.findFirst({
      where: { workspaceId, ...where },
      select: {
        id: true,
        rows: {
          select: { line: true, username: true, userId: true, access: true, mailId: true },
          orderBy: { line: 'asc' }
        }
      }
    })
  )
  if (!found) return null
  const mailIds = found.rows.map(r => r.mailId).filter((id): id is string => !!id)
  const mails = await prisma.outgoingMail.findMany({
    where: { id: { in: mailIds } },
    select: { id: true, status: true }
  })
  const status = new Map(mails.map(m => [m.id, m.status]))
  return {
    importId: found.id,
    rows: found.rows.map((r): ImportOutcomeRow => ({
      line: r.line,
      username: r.username,
      userId: r.userId,
      access: r.access,
      mailStatus: r.mailId ? (status.get(r.mailId) ?? null) : null
    }))
  }
}

export class ImportChangedError extends Error {
  constructor(public errors: RowError[]) {
    super('The data changed since the preview')
  }
}

const HASH_CONCURRENCY = 4

/**
 * Creates every account of a validated file. Passwords are generated and
 * hashed before the transaction, so it stays short. Returns null when the key
 * was already committed (the caller answers with the stored outcome).
 */
export async function commitImport(
  actor: CurrentUser,
  input: { importKey: string; fileName: string; rows: ImportRow[] }
): Promise<{ importId: string; rows: ImportOutcomeRow[] } | null> {
  const ordered = creationOrder(input.rows)
  const passwords = new Map<string, string>()
  for (const row of ordered) {
    if (row.access === 'password' && row.password) passwords.set(row.username, row.password)
    if (row.access === 'generate' || row.access === 'email_password') {
      let password: string
      do password = generateTemporaryPassword()
      while (passwordProblem(password, row))
      passwords.set(row.username, password)
    }
  }
  const hashes = new Map<string, string>()
  const entries = [...passwords.entries()]
  for (let i = 0; i < entries.length; i += HASH_CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + HASH_CONCURRENCY).map(async ([username, password]) => {
        hashes.set(username, await hashPassword(password))
      })
    )
  }

  const workspaceId = actor.workspaceId
  let created: { importId: string; rows: Array<ImportOutcomeRow & { mailId: string | null }> }
  try {
    created = await withWorkspace(
      workspaceId,
      async () => {
        // First, so a concurrent commit with the same key waits here and then fails.
        const record = await db().memberImport.create({
          data: {
            workspaceId,
            importKey: input.importKey,
            fileName: input.fileName,
            createdById: actor.id,
            rowCount: ordered.length
          },
          select: { id: true }
        })
        const changed = await databaseErrors(workspaceId, ordered)
        if (changed.length) throw new ImportChangedError(changed)

        const outside = ordered
          .map(r => r.supervisor)
          .filter((s): s is string => !!s && !ordered.some(r => r.username === s))
        const membershipIds = await existingSupervisors(workspaceId, outside)
        const outcome: Array<ImportOutcomeRow & { mailId: string | null }> = []
        for (const row of ordered) {
          const user = await db().user.create({
            data: {
              username: row.username,
              displayUsername: row.displayUsername,
              email: row.email,
              name: row.name,
              mustResetPassword: row.access !== 'invite',
              invitedAt: row.access === 'invite' ? new Date() : null,
              createdById: actor.id
            },
            select: { id: true }
          })
          const hash = hashes.get(row.username)
          if (hash) await setPasswordHash(db(), user.id, hash)
          const membership = await db().workspaceMembership.create({
            data: {
              workspaceId,
              userId: user.id,
              role: row.role,
              supervisorMembershipId: row.supervisor ? (membershipIds.get(row.supervisor) ?? null) : null,
              addedById: actor.id
            },
            select: { id: true }
          })
          membershipIds.set(row.username, membership.id)
          const mailId =
            row.access === 'invite'
              ? await queueMail(db(), { purpose: 'invitation', userId: user.id, workspaceId, requestedById: actor.id })
              : row.access === 'email_password'
                ? await queueCredentialMail(db(), { userId: user.id, workspaceId, requestedById: actor.id })
                : null
          outcome.push({
            line: row.line,
            username: row.username,
            userId: user.id,
            access: row.access,
            mailId,
            mailStatus: mailId ? 'pending' : null
          })
        }
        await db().memberImportRow.createMany({
          data: outcome.map(r => ({
            workspaceId,
            importId: record.id,
            line: r.line,
            username: r.username,
            userId: r.userId,
            access: r.access,
            mailId: r.mailId
          }))
        })
        const count = (key: 'role' | 'access') =>
          ordered.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {})
        await audit({
          actorId: actor.id,
          action: 'members.imported',
          entityType: 'member_import',
          entityId: record.id,
          payload: { count: ordered.length, roles: count('role'), access: count('access'), authority: actor.authority }
        })
        return { importId: record.id, rows: outcome }
      },
      { write: true, timeoutMs: 120_000 }
    )
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') {
      const target = JSON.stringify(caught.meta ?? {})
      if (target.includes('importKey')) return null
      throw new ImportChangedError([
        { line: 0, field: 'file', message: 'An account was created meanwhile; preview again' }
      ])
    }
    throw caught
  }

  // After the commit: links through the outbox, passwords from memory.
  deliverSoon(created.rows.filter(r => r.access === 'invite' && r.mailId).map(r => r.mailId!))
  sendCredentialMailSoon(
    created.rows
      .filter(r => r.access === 'email_password' && r.mailId)
      .map(r => ({ mailId: r.mailId!, password: passwords.get(r.username)! }))
  )
  return {
    importId: created.importId,
    rows: created.rows
      .map((r): ImportOutcomeRow => ({
        line: r.line,
        username: r.username,
        userId: r.userId,
        access: r.access,
        mailStatus: r.mailStatus,
        ...(r.access === 'generate' ? { password: passwords.get(r.username)! } : {})
      }))
      .sort((a, b) => a.line - b.line)
  }
}
