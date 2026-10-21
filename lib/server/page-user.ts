import 'server-only'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import type { CurrentUser, Role } from '@/lib/api-auth'

/**
 * The signed-in user for a server page. Without a session it redirects to the
 * sign-in page; with `roles` given, other roles go back to the queue.
 * (proxy.ts has already sent users who must reset their password away.)
 */
export async function requirePageUser(...roles: Role[]): Promise<CurrentUser> {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  const user = { id: session.user.id, role: session.user.role as Role }
  if (roles.length > 0 && !roles.includes(user.role)) redirect('/queue')
  return user
}
