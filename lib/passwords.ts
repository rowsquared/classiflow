import { hashPassword, verifyPassword } from 'better-auth/crypto'
import type { Prisma } from '@/lib/generated/prisma/client'

/** Usernames: letters, digits, dot, underscore and hyphen; stored in lower case. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

/** Better Auth keeps the password hash on this Account row (accountId = user id). */
export const CREDENTIAL_PROVIDER = 'credential'

type Db = Pick<Prisma.TransactionClient, 'account' | 'session'>

/** Sets (or first creates) a user's password with Better Auth's own hashing. */
export async function setPassword(db: Db, userId: string, password: string) {
  const hash = await hashPassword(password)
  await db.account.upsert({
    where: { providerId_accountId: { providerId: CREDENTIAL_PROVIDER, accountId: userId } },
    create: { providerId: CREDENTIAL_PROVIDER, accountId: userId, userId, password: hash },
    update: { password: hash }
  })
}

export async function checkPassword(db: Db, userId: string, password: string): Promise<boolean> {
  const account = await db.account.findUnique({
    where: { providerId_accountId: { providerId: CREDENTIAL_PROVIDER, accountId: userId } },
    select: { password: true }
  })
  if (!account?.password) return false
  return verifyPassword({ hash: account.password, password })
}

/** Signs the user out everywhere, or everywhere except `keepSessionId`. */
export async function revokeSessions(db: Db, userId: string, keepSessionId?: string) {
  await db.session.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) }
  })
}
