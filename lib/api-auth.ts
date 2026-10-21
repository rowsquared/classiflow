import { NextResponse } from 'next/server'
import { getSession, type AuthSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

export type Role = 'admin' | 'supervisor' | 'labeller'

/** The signed-in user as currently stored in the database. */
export type CurrentUser = { id: string; role: Role }

type AuthResult =
  | { session: AuthSession; user: CurrentUser; error?: undefined }
  | { session?: undefined; user?: undefined; error: NextResponse }

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

/**
 * Session check for API route handlers. proxy.ts lets every /api request
 * through, so each handler must call this before touching data.
 *
 *   const { user, error } = await requireSession('admin')
 *   if (error) return error
 *
 * With no roles, any signed-in user passes. Sessions are database rows and
 * getSession() reads the session and its user on every call, so role changes,
 * deletions, bans and revoked sessions take effect immediately.
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
  const session = await getSession()
  if (!session?.user?.id) {
    return { error: unauthorized() }
  }

  if (session.user.mustResetPassword && !allowPasswordReset) {
    return {
      error: NextResponse.json(
        { error: 'Password reset required', code: 'PASSWORD_RESET_REQUIRED' },
        { status: 403 }
      ),
    }
  }
  const role = session.user.role as Role
  if (roles.length > 0 && !roles.includes(role)) {
    await audit({
      actorId: session.user.id, action: 'access.denied', entityType: 'role', entityId: roles.join('|'),
      payload: { reason: 'role', role },
    })
    return { error: forbidden() }
  }

  return { session, user: { id: session.user.id, role } }
}
