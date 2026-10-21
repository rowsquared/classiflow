import { randomInt } from 'node:crypto'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import type { Prisma } from '@/lib/generated/prisma/client'
// Relative with .ts: scripts/*.ts load this file with Node's type stripping.
import { invalidateAccountLinks } from './account-links.ts'

/** Usernames: letters, digits, dot, underscore and hyphen; stored in lower case. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

/** Better Auth keeps the password hash on this Account row (accountId = user id). */
export const CREDENTIAL_PROVIDER = 'credential'

type Db = Pick<Prisma.TransactionClient, 'account' | 'session' | 'verification'>

/**
 * Sets (or first creates) a user's password with Better Auth's own hashing.
 * Open password links of the account stop working (lib/account-links.ts).
 */
export async function setPassword(db: Db, userId: string, password: string) {
  const hash = await hashPassword(password)
  await setPasswordHash(db, userId, hash)
}

/** setPassword() with a hash made earlier (bulk imports hash before their transaction). */
export async function setPasswordHash(db: Db, userId: string, hash: string) {
  await db.account.upsert({
    where: { providerId_accountId: { providerId: CREDENTIAL_PROVIDER, accountId: userId } },
    create: { providerId: CREDENTIAL_PROVIDER, accountId: userId, userId, password: hash },
    update: { password: hash }
  })
  await invalidateAccountLinks(db, userId)
}

export { hashPassword }

export async function checkPassword(db: Db, userId: string, password: string): Promise<boolean> {
  const account = await db.account.findUnique({
    where: { providerId_accountId: { providerId: CREDENTIAL_PROVIDER, accountId: userId } },
    select: { password: true }
  })
  if (!account?.password) return false
  return verifyPassword({ hash: account.password, password })
}

/**
 * Signs the user out everywhere, or everywhere except `keepSessionId`, and
 * ends their open password links.
 */
export async function revokeSessions(db: Db, userId: string, keepSessionId?: string) {
  await db.session.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) }
  })
  await invalidateAccountLinks(db, userId)
}

const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * An 18-character temporary password from an unambiguous alphabet (the same
 * as the Team page's generator, lib/team-table.ts), made on the server with
 * cryptographic randomness. The caller checks it against the policy.
 */
export function generateTemporaryPassword(): string {
  return Array.from({ length: 18 }, () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]).join('')
}
