import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { createHash } from 'node:crypto'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { admin, username } from 'better-auth/plugins'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { USERNAME_PATTERN } from '@/lib/passwords'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { allowRequest, clientIp } from '@/lib/rate-limit'
import { logError } from '@/lib/logger'
import { audit } from '@/lib/audit'

const signInPerIp = { windowSeconds: 60, max: Number(process.env.SIGN_IN_RATE_LIMIT) || 10 }
const signInPerAccount = { windowSeconds: 900, max: Number(process.env.SIGN_IN_ACCOUNT_RATE_LIMIT) || 10 }
const adminPlugin = admin({ defaultRole: 'user', adminRoles: ['admin'] })

function signInLimited(retryAfter: number) {
  return new APIError(
    'TOO_MANY_REQUESTS',
    { message: 'Too many sign-in attempts. Please try again later.' },
    { 'Retry-After': String(retryAfter) }
  )
}

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
      // These two endpoints use the application's IP and account limits.
      '/sign-in/email': false,
      '/sign-in/username': false,
      // Reading one's own session is not limited: a counter only resets after
      // a quiet window, so steady traffic from one address (an office behind
      // one IP) would eventually be refused and the app would lose its session.
      '/get-session': false
    }
  },
  advanced: { ipAddress: { ipAddressHeaders: ['x-classiflow-client-ip'] } },
  hooks: {
    before: createAuthMiddleware(async ctx => {
      const field = ctx.path === '/sign-in/email' ? 'email' : ctx.path === '/sign-in/username' ? 'username' : null
      if (!field) return
      try {
        const ip = ctx.request ? clientIp(ctx.request) : 'unknown'
        if (ip !== 'unknown' && !(await allowRequest(`sign-in:ip:${ip}`, signInPerIp))) {
          throw signInLimited(signInPerIp.windowSeconds)
        }
        const value: unknown = ctx.body?.[field]
        if (typeof value !== 'string') return
        const identifier = value.trim().toLowerCase()
        const where = field === 'email' ? { email: identifier } : { username: identifier }
        const account = await prisma.user.findUnique({ where, select: { id: true } })
        const key = account?.id ?? createHash('sha256').update(`${field}:${identifier}`).digest('hex')
        if (!(await allowRequest(`sign-in:account:${key}`, signInPerAccount))) {
          throw signInLimited(signInPerAccount.windowSeconds)
        }
      } catch (error) {
        if (error instanceof APIError) throw error
        await logError('Could not check sign-in limits', error)
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'Sign-in is temporarily unavailable' })
      }
    })
  },
  databaseHooks: {
    session: {
      create: {
        // Raw SQL so a sign-in does not count as an edit of the account (updatedAt).
        after: async session => {
          await prisma.$executeRaw`UPDATE "User" SET "lastLogin" = (now() AT TIME ZONE 'UTC') WHERE id = ${session.userId}`
          await audit({
            workspaceId: null,
            actorId: session.userId,
            action: 'user.signed_in',
            entityType: 'user',
            entityId: session.userId
          })
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
    // Keep the ban checks on session creation. Administration is handled by the app.
    adminPlugin,
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
    ...Object.values(adminPlugin.endpoints).map(endpoint => endpoint.path)
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
