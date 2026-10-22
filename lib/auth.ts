import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { admin, username } from 'better-auth/plugins'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { USERNAME_PATTERN } from '@/lib/passwords'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

// Sign-in attempts per client IP per minute (ENV_SETUP.md).
const SIGN_IN_LIMIT = { window: 60, max: Number(process.env.SIGN_IN_RATE_LIMIT) || 10 }

/**
 * Better Auth: database sessions (one Session row per browser), passwords on
 * the "credential" Account row. Users are created and changed by the app's own
 * admin API (app/api/users), not by Better Auth's sign-up or admin endpoints,
 * so those are switched off below. BETTER_AUTH_SECRET and BETTER_AUTH_URL come
 * from the environment (ENV_SETUP.md).
 */
export const auth = betterAuth({
  appName: 'classiflow',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH
  },
  user: {
    additionalFields: {
      // Set for new users and admin-set passwords; proxy.ts and
      // lib/api-auth.ts allow only the reset page until it is cleared.
      mustResetPassword: { type: 'boolean', defaultValue: true, input: false }
    }
  },
  rateLimit: {
    // Counted per client IP in the database, so every instance shares them.
    // Better Auth enables rate limiting in production only.
    storage: 'database',
    customRules: {
      '/sign-in/email': SIGN_IN_LIMIT,
      '/sign-in/username': SIGN_IN_LIMIT,
      // Reading one's own session is not limited: a counter only resets after
      // a quiet window, so steady traffic from one address (an office behind
      // one IP) would eventually be refused and the app would lose its session.
      '/get-session': false
    }
  },
  databaseHooks: {
    session: {
      create: {
        // Raw SQL so a sign-in does not count as an edit of the account (updatedAt).
        after: async session => {
          await prisma.$executeRaw`UPDATE "User" SET "lastLogin" = (now() AT TIME ZONE 'UTC') WHERE id = ${session.userId}`
        }
      }
    }
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 100,
      usernameValidator: name => USERNAME_PATTERN.test(name)
    }),
    // Ban/unban and per-user session listing and revocation for admins; the
    // roles stay ours (Role enum), and only "admin" may call these endpoints.
    admin({ defaultRole: 'labeller', adminRoles: ['admin'] }),
    nextCookies()
  ],
  // Account changes go through app/api/users and app/api/auth/reset-password,
  // which apply the team rules and write the audit log.
  disabledPaths: [
    '/update-user',
    '/change-email',
    '/change-password',
    '/set-password',
    '/delete-user',
    '/request-password-reset',
    '/reset-password',
    '/is-username-available',
    '/admin/create-user',
    '/admin/update-user',
    '/admin/set-role',
    '/admin/set-user-password',
    '/admin/remove-user',
    '/admin/impersonate-user',
    '/admin/stop-impersonating'
  ]
})

export type AuthSession = typeof auth.$Infer.Session

/**
 * The current request's session, read from the database (no cookie cache), or
 * null. Server components and lib/api-auth.ts use this; integration tests
 * replace it (tests/integration/setup.ts).
 */
export async function getSession(): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: await headers() })
}
