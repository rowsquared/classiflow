import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveWorkspaceUser, type CurrentUser, type Role, type SessionUser } from '@/lib/api-auth'

/** The signed-in identity for a server page; redirects to sign-in without one. */
export async function requirePageSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  return { id: session.user.id, platformRole: session.user.role === 'admin' ? 'admin' : 'user' }
}

/**
 * The signed-in user inside a workspace, for pages under /w/[workspaceId].
 * An unknown or inaccessible workspace is a 404 (its existence is not
 * revealed); with `roles` given, other roles go back to the queue.
 * (proxy.ts has already sent users who must reset their password away.)
 */
export async function requirePageUser(workspaceId: string, ...roles: Role[]): Promise<CurrentUser> {
  const user = await resolveWorkspaceUser(await requirePageSession(), workspaceId)
  if (!user) notFound()
  if (roles.length > 0 && !roles.includes(user.role)) redirect(`/w/${workspaceId}/queue`)
  return user
}
