import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@/lib/generated/prisma/client'

/**
 * Links that let a person choose a password: invitations for new accounts
 * (U7b) and forgotten-password links (U7c). Stored in Better Auth's
 * `Verification` table, one row per link, identifier `account-link:<userId>`;
 * the row keeps only a SHA-256 of the link's secret, the purpose and the email
 * address the link was sent to.
 *
 * A link stops working when it is used, when it expires, when the account's
 * password is set or its sessions are revoked (lib/passwords.ts deletes every
 * link of the account), when the email address changes, or when the account
 * is banned. The token is `<userId>.<secret>` and travels in the URL fragment
 * (`/set-password#t=...`), so it never reaches a server log or a Referer.
 *
 * Better Auth's own reset endpoints stay disabled: confirming needs the
 * password policy, a row lock, the audit entry and the notice mail.
 */

export type LinkPurpose = 'invitation' | 'password_link'

const PREFIX = 'account-link:'

type Stored = { h: string; p: LinkPurpose; e: string }

type Db = Pick<Prisma.TransactionClient, 'verification'>

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const linkIdentifier = (userId: string) => `${PREFIX}${userId}`

export function parseLinkToken(token: unknown): { userId: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const match = /^([a-z0-9]{10,40})\.([A-Za-z0-9_-]{32,64})$/.exec(token)
  return match ? { userId: match[1]!, secret: match[2]! } : null
}

/** A new link for the account; returns the token (only ever put in the mail). */
export async function issueAccountLink(
  db: Db,
  input: { userId: string; email: string; purpose: LinkPurpose; ttlMs: number }
): Promise<string> {
  const secret = randomBytes(32).toString('base64url')
  const value: Stored = { h: sha256(secret), p: input.purpose, e: input.email }
  await db.verification.create({
    data: {
      identifier: linkIdentifier(input.userId),
      value: JSON.stringify(value),
      expiresAt: new Date(Date.now() + input.ttlMs)
    }
  })
  return `${input.userId}.${secret}`
}

function matches(stored: string, secret: string): Stored | null {
  let parsed: Stored
  try {
    parsed = JSON.parse(stored) as Stored
  } catch {
    return null
  }
  if (typeof parsed?.h !== 'string') return null
  const a = Buffer.from(parsed.h, 'hex')
  const b = Buffer.from(sha256(secret), 'hex')
  return a.length === b.length && timingSafeEqual(a, b) ? parsed : null
}

/**
 * The link's purpose when the token is valid for the account as it is now
 * (`currentEmail`), or null. Does not use the link up: opening a link (or a
 * mail scanner fetching it) spends nothing.
 */
export async function findAccountLink(
  db: Db,
  token: unknown,
  currentEmail: string
): Promise<{ userId: string; purpose: LinkPurpose } | null> {
  const parsed = parseLinkToken(token)
  if (!parsed) return null
  const rows = await db.verification.findMany({
    where: { identifier: linkIdentifier(parsed.userId), expiresAt: { gt: new Date() } },
    select: { value: true }
  })
  for (const row of rows) {
    const stored = matches(row.value, parsed.secret)
    if (stored) return stored.e === currentEmail ? { userId: parsed.userId, purpose: stored.p } : null
  }
  return null
}

/** Deletes every link of the account (password set, sessions revoked, email changed). */
export async function invalidateAccountLinks(db: Db, userId: string) {
  await db.verification.deleteMany({ where: { identifier: linkIdentifier(userId) } })
}

/** Expired link rows; called with the outbox recovery. */
export async function deleteExpiredAccountLinks(db: Db) {
  await db.verification.deleteMany({ where: { identifier: { startsWith: PREFIX }, expiresAt: { lt: new Date() } } })
}
