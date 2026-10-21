import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { auth } from '@/lib/auth'

export type Role = 'admin' | 'supervisor' | 'labeller'

type AuthResult =
  | { session: Session; error?: undefined }
  | { session?: undefined; error: NextResponse }

/**
 * Session check for API route handlers. middleware.ts lets every /api request
 * through, so each handler must call this (or auth() itself) before touching data.
 *
 *   const { session, error } = await requireSession('admin')
 *   if (error) return error
 *
 * With no roles, any signed-in user passes.
 */
export async function requireSession(...roles: Role[]): Promise<AuthResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (roles.length > 0 && !roles.includes(session.user.role as Role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}
