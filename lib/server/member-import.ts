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
import { createInvitation } from '@/lib/server/invitations'
import { db, withWorkspace } from '@/lib/workspace/db'

// CSV member import (U4) into one workspace: a dry run that writes and mails
// nothing, then a commit that applies every row in one transaction or none.
// Each row's email decides its outcome:
// - no account: `create` a new account and membership (username, name and
//   access required, as before);
// - an account that is an active member here: `unchanged` (the role and
//   supervisor in the file are not applied; change them in the member list);
// - an account removed from this workspace: `restore`, only when the commit
//   confirms it (`confirmRestore`);
// - any other account: `add` it directly for platform admins, or `invite` it
//   (`invitation`, mail) for workspace admins, who do not attach outside
//   identities.
// Existing profiles and passwords are never changed. The commit carries a key
// chosen by the browser; a replayed or concurrent commit with the same key
// returns the stored outcome and creates and mails nothing. Mail goes out
// after the commit: links through the outbox, generated passwords from memory
// (never stored).

export type RowOutcome = 'create' | 'add' | 'restore' | 'unchanged' | 'invitation'

export type PlannedRow = ImportRow & {
  outcome: RowOutcome
  /** The existing account (not for invitations: workspace admins do not learn it). */
  userId: string | null
  /** The membership to restore. */
  membershipId: string | null
  note: string | null
}

export type ImportOutcomeRow = {
  line: number
  username: string
  userId: string | null
  /** The access mode of a new account, otherwise the outcome (add, restore, unchanged, invitation). */
  access: string
  mailStatus: string | null
  /** Only for `generate`, only in the commit response. */
  password?: string
}

type Prepared = { rows: PlannedRow[]; errors: RowError[]; fileErrors: string[] }

/** Parses the file and plans every row against existing accounts and this workspace. */
export async function prepareImport(actor: CurrentUser, text: string): Promise<Prepared> {
  const parsed = parseMemberCsv(text, { mailEnabled: mailEnabled() })
  if (parsed.fileErrors.length) return { rows: [], errors: [], fileErrors: parsed.fileErrors }
  const planned = await withWorkspace(actor.workspaceId, () => planRows(actor, parsed.rows))
  const errors = [...parsed.errors, ...planned.errors].sort((a, b) => a.line - b.line)
  return { rows: planned.rows, errors, fileErrors: [] }
}

/** Each row's outcome and the checks that need the database. Runs in a workspace transaction. */
async function planRows(actor: CurrentUser, rows: ImportRow[]) {
  const workspaceId = actor.workspaceId
  const errors: RowError[] = []
  const error = (line: number, field: string, message: string) => errors.push({ line, field, message })
  const accounts = await db().user.findMany({
    where: {
      OR: [{ email: { in: rows.map(r => r.email) } }, { username: { in: rows.map(r => r.username).filter(Boolean) } }]
    },
    select: {
      id: true,
      username: true,
      email: true,
      banned: true,
      memberships: { where: { workspaceId }, select: { id: true, status: true, role: true } }
    }
  })
  const byEmail = new Map(accounts.map(a => [a.email, a]))
  const usernames = new Set(accounts.map(a => a.username))

  const planned = rows.map((row): PlannedRow => {
    const account = byEmail.get(row.email)
    if (!account) {
      if (!row.username) error(row.line, 'username', 'Username is required for a new account')
      else if (usernames.has(row.username)) error(row.line, 'username', 'Username already in use')
      if (!row.name) error(row.line, 'name', 'Name is required for a new account')
      if (!row.access) error(row.line, 'access', 'Access is required for a new account')
      return { ...row, outcome: 'create', userId: null, membershipId: null, note: null }
    }
    if (row.username && row.username !== account.username) {
      error(row.line, 'username', 'This email already has an account; leave the username empty')
    }
    if (row.password) error(row.line, 'password', 'Existing accounts keep their password; leave it empty')
    const membership = account.memberships[0]
    const existing = { ...row, username: account.username, userId: account.id, membershipId: membership?.id ?? null }
    if (membership?.status === 'active') {
      const note = membership.role === row.role ? 'Already a member' : `Already a member; stays ${membership.role}`
      return { ...existing, outcome: 'unchanged', note }
    }
    if (membership) return { ...existing, outcome: 'restore', note: 'Was removed; access is restored' }
    if (actor.authority === 'platform') {
      if (account.banned) error(row.line, 'email', 'This account is disabled')
      return { ...existing, outcome: 'add', note: 'Existing account' }
    }
    if (!mailEnabled()) error(row.line, 'email', 'This person needs an invitation, which needs email')
    return { ...row, outcome: 'invitation', userId: null, membershipId: null, note: 'Invitation by email' }
  })

  // Supervisors: an admin or supervisor row of this file that becomes a member,
  // or an active admin or supervisor here. Not applied to unchanged rows.
  const inFile = new Map(
    planned.filter(r => r.username && r.outcome !== 'unchanged' && r.outcome !== 'invitation').map(r => [r.username, r])
  )
  const named = rows.map(r => r.username)
  const applied = planned.filter(r => r.supervisor && r.outcome !== 'unchanged')
  const outside = [...new Set(applied.map(r => r.supervisor!).filter(s => !inFile.has(s)))]
  const members = await existingSupervisors(workspaceId, outside)
  for (const row of applied) {
    const target = inFile.get(row.supervisor!)
    // Rows named by their username in the file were checked by the parser.
    if (target && target.role === 'labeller' && !named.includes(target.username)) {
      error(row.line, 'supervisor', 'The supervisor must be an admin or supervisor')
    }
    if (!target && !members.has(row.supervisor!)) {
      error(row.line, 'supervisor', 'No admin or supervisor with this username in this workspace or the file')
    }
  }
  return { rows: planned, errors }
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

export function previewRows(rows: PlannedRow[]) {
  return rows.map(row => ({
    line: row.line,
    username: row.username,
    displayUsername: row.displayUsername,
    email: row.email,
    name: row.name,
    role: row.role,
    supervisor: row.supervisor,
    access: row.access,
    outcome: row.outcome,
    note: row.note
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
 * Applies every row of a validated file. Passwords for new accounts are
 * generated and hashed before the transaction, so it stays short; the rows
 * are planned again inside it. Returns null when the key was already
 * committed (the caller answers with the stored outcome).
 */
export async function commitImport(
  actor: CurrentUser,
  input: { importKey: string; fileName: string; rows: PlannedRow[]; confirmRestore: boolean }
): Promise<{ importId: string; rows: ImportOutcomeRow[] } | null> {
  const passwords = new Map<number, string>()
  for (const row of input.rows) {
    if (row.outcome !== 'create') continue
    if (row.access === 'password' && row.password) passwords.set(row.line, row.password)
    if (row.access === 'generate' || row.access === 'email_password') {
      let password: string
      do password = generateTemporaryPassword()
      while (passwordProblem(password, row))
      passwords.set(row.line, password)
    }
  }
  const hashes = new Map<number, string>()
  const entries = [...passwords.entries()]
  for (let i = 0; i < entries.length; i += HASH_CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + HASH_CONCURRENCY).map(async ([line, password]) => {
        hashes.set(line, await hashPassword(password))
      })
    )
  }

  const workspaceId = actor.workspaceId
  type Outcome = ImportOutcomeRow & { mailId: string | null }
  let created: { importId: string; rows: Outcome[] }
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
            rowCount: input.rows.length
          },
          select: { id: true }
        })
        // Planned again: accounts and memberships may have changed since the preview.
        const plan = await planRows(actor, input.rows)
        const unconfirmed = input.confirmRestore ? [] : plan.rows.filter(r => r.outcome === 'restore')
        const problems = [
          ...plan.errors,
          ...unconfirmed.map(r => ({ line: r.line, field: 'email', message: 'Confirm restoring removed members' }))
        ]
        if (problems.length) throw new ImportChangedError(problems)
        const ordered = creationOrder(plan.rows)
        if (plan.rows.some((r, i) => r.outcome !== input.rows[i]!.outcome)) {
          // The preview's outcomes still apply where they changed only to "unchanged"; anything else needs a new look.
          const moved = plan.rows.filter((r, i) => r.outcome !== input.rows[i]!.outcome && r.outcome !== 'unchanged')
          if (moved.length) {
            throw new ImportChangedError(
              moved.map(r => ({ line: r.line, field: 'email', message: 'This row changed since the preview' }))
            )
          }
        }

        const inFile = new Set(ordered.map(r => r.username).filter(Boolean))
        const outside = ordered.map(r => r.supervisor).filter((s): s is string => !!s && !inFile.has(s))
        const membershipIds = await existingSupervisors(workspaceId, outside)
        const outcome: Outcome[] = []
        for (const row of ordered) {
          const supervisorMembershipId =
            row.supervisor && row.outcome !== 'unchanged' ? (membershipIds.get(row.supervisor) ?? null) : null
          let userId = row.userId
          let mailId: string | null = null
          if (row.outcome === 'create') {
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
            userId = user.id
            const hash = hashes.get(row.line)
            if (hash) await setPasswordHash(db(), user.id, hash)
            mailId =
              row.access === 'invite'
                ? await queueMail(db(), {
                    purpose: 'invitation',
                    userId: user.id,
                    workspaceId,
                    requestedById: actor.id
                  })
                : row.access === 'email_password'
                  ? await queueCredentialMail(db(), { userId: user.id, workspaceId, requestedById: actor.id })
                  : null
          }
          if (row.outcome === 'create' || row.outcome === 'add') {
            const membership = await db().workspaceMembership.create({
              data: { workspaceId, userId: userId!, role: row.role, supervisorMembershipId, addedById: actor.id },
              select: { id: true }
            })
            membershipIds.set(row.username, membership.id)
          }
          if (row.outcome === 'restore') {
            await db().workspaceMembership.update({
              where: { id: row.membershipId! },
              data: { status: 'active', role: row.role, supervisorMembershipId, addedById: actor.id }
            })
            membershipIds.set(row.username, row.membershipId!)
          }
          if (row.outcome === 'invitation') {
            mailId = (await createInvitation(actor, { email: row.email, role: row.role, supervisorMembershipId }))
              .mailId
          }
          outcome.push({
            line: row.line,
            username: row.username || row.email,
            userId,
            access: row.outcome === 'create' ? row.access! : row.outcome,
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
        const count = (values: string[]) =>
          values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {})
        const added = ordered.filter(r => r.outcome !== 'unchanged' && r.outcome !== 'invitation')
        await audit({
          actorId: actor.id,
          action: 'members.imported',
          entityType: 'member_import',
          entityId: record.id,
          payload: {
            count: ordered.length,
            outcomes: count(ordered.map(r => r.outcome)),
            roles: count(added.map(r => r.role)),
            access: count(ordered.filter(r => r.outcome === 'create').map(r => r.access!)),
            authority: actor.authority
          }
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
  deliverSoon(
    created.rows.filter(r => (r.access === 'invite' || r.access === 'invitation') && r.mailId).map(r => r.mailId!)
  )
  sendCredentialMailSoon(
    created.rows
      .filter(r => r.access === 'email_password' && r.mailId)
      .map(r => ({ mailId: r.mailId!, password: passwords.get(r.line)! }))
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
        ...(r.access === 'generate' ? { password: passwords.get(r.line)! } : {})
      }))
      .sort((a, b) => a.line - b.line)
  }
}
