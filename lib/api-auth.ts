import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

export type Role = 'admin' | 'supervisor' | 'labeller'

/** The signed-in user as currently stored in the database (not as the JWT remembers them). */
export type CurrentUser = { id: string; role: Role }

type AuthResult =
  | { session: Session; user: CurrentUser; error?: undefined }
  | { session?: undefined; user?: undefined; error: NextResponse }

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

/**
 * Session check for API route handlers. middleware.ts lets every /api request
 * through, so each handler must call this before touching data.
 *
 *   const { user, error } = await requireSession('admin')
 *   if (error) return error
 *
 * With no roles, any signed-in user passes. The JWT only proves who the caller
 * signed in as: role, the password-reset flag and the session version are read
 * from the database on every call, so demotion, deletion and password resets
 * take effect immediately instead of when the token expires.
 */
export async function requireSession(...roles: Role[]): Promise<AuthResult> {
  return checkSession(roles, false)
}

/**
 * Like requireSession(), but also admits users who still have to change their
 * initial password. Only the password-reset endpoint should use this.
 */
export async function requireSessionAllowingReset(): Promise<AuthResult> {
  return checkSession([], true)
}

async function checkSession(roles: Role[], allowPasswordReset: boolean): Promise<AuthResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: unauthorized() }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, mustResetPassword: true, sessionVersion: true },
  })
  // Deleted users and sessions issued before the last password change are signed out.
  if (!dbUser || dbUser.sessionVersion !== (session.user.sessionVersion ?? 0)) {
    return { error: unauthorized('Session expired, please sign in again') }
  }
  if (dbUser.mustResetPassword && !allowPasswordReset) {
    return {
      error: NextResponse.json(
        { error: 'Password reset required', code: 'PASSWORD_RESET_REQUIRED' },
        { status: 403 }
      ),
    }
  }
  const role = dbUser.role as Role
  if (roles.length > 0 && !roles.includes(role)) {
    await audit({
      actorId: dbUser.id, action: 'access.denied', entityType: 'role', entityId: roles.join('|'),
      payload: { reason: 'role', role },
    })
    return { error: forbidden() }
  }

  session.user.role = role
  session.user.mustResetPassword = dbUser.mustResetPassword
  return { session, user: { id: dbUser.id, role } }
}
