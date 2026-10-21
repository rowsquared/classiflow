import { NextResponse, type NextRequest } from 'next/server'
import { getSession, type AuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { withWorkspace, WorkspaceArchivedError } from '@/lib/workspace/db'

/** A person's role inside one workspace. */
export type Role = 'admin' | 'supervisor' | 'labeller'
export type PlatformRole = 'admin' | 'user'

/** The signed-in identity, as currently stored in the database. */
export type SessionUser = { id: string; platformRole: PlatformRole }

/**
 * The signed-in user inside one workspace: `id` is the user's id and `role`
 * their effective role there. Platform admins act as admins of every
 * workspace (authority 'platform', possibly without a membership).
 */
export type CurrentUser = {
  id: string
  role: Role
  workspaceId: string
  membershipId: string | null
  authority: 'membership' | 'platform'
  archived: boolean
}

type SessionResult =
  | { session: AuthSession; user: SessionUser; error?: undefined }
  | { session?: undefined; user?: undefined; error: NextResponse }

type WorkspaceResult =
  | { session: AuthSession; user: CurrentUser; error?: undefined }
  | { session?: undefined; user?: undefined; error: NextResponse }

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 })
}

/**
 * Session check for API route handlers. proxy.ts lets every /api request
 * through, so each handler must call this (or requireWorkspace /
 * requirePlatformAdmin) before touching data.
 *
 * Sessions are database rows and getSession() reads the session and its user
 * on every call, so deletions, bans and revoked sessions take effect at once.
 */
export async function requireSession(): Promise<SessionResult> {
  return checkSession(false)
}

/**
 * Like requireSession(), but also admits users who still have to change their
 * initial password. Only the password-reset endpoint should use this.
 */
export async function requireSessionAllowingReset(): Promise<SessionResult> {
  return checkSession(true)
}

/** Platform administration: workspaces and global accounts. */
export async function requirePlatformAdmin(): Promise<SessionResult> {
  const result = await checkSession(false)
  if (result.error) return result
  if (result.user.platformRole !== 'admin') {
    await audit({
      actorId: result.user.id, action: 'access.denied', entityType: 'platform', entityId: 'admin',
      payload: { reason: 'platform role' },
    })
    return { error: forbidden() }
  }
  return result
}

async function checkSession(allowPasswordReset: boolean): Promise<SessionResult> {
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
  const platformRole: PlatformRole = session.user.role === 'admin' ? 'admin' : 'user'
  return { session, user: { id: session.user.id, platformRole } }
}

/**
 * The caller inside a workspace, from the current session, workspace and
 * membership rows (never from a cookie or a remembered role). An unknown or
 * inaccessible workspace is a 404, so its existence is not revealed; a role
 * that may not do this is a 403.
 */
export async function resolveWorkspaceUser(
  sessionUser: SessionUser,
  workspaceId: string
): Promise<CurrentUser | null> {
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { status: true } }),
    prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: sessionUser.id } },
      select: { id: true, role: true, status: true },
    }),
  ])
  if (!workspace) return null
  const archived = workspace.status === 'archived'
  if (sessionUser.platformRole === 'admin') {
    return {
      id: sessionUser.id, role: 'admin', workspaceId,
      membershipId: membership?.status === 'active' ? membership.id : null,
      authority: 'platform', archived,
    }
  }
  if (!membership || membership.status !== 'active') return null
  return {
    id: sessionUser.id, role: membership.role, workspaceId,
    membershipId: membership.id, authority: 'membership', archived,
  }
}

/**
 * The user's current standing in a workspace, re-read from the database (for
 * long operations that re-check access, such as streamed exports). Banned or
 * deleted users have none.
 */
export async function reloadWorkspaceUser(userId: string, workspaceId: string): Promise<CurrentUser | null> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, banned: true } })
  if (!account || account.banned) return null
  return resolveWorkspaceUser({ id: userId, platformRole: account.role === 'admin' ? 'admin' : 'user' }, workspaceId)
}

export async function requireWorkspace(workspaceId: string, ...roles: Role[]): Promise<WorkspaceResult> {
  const result = await checkSession(false)
  if (result.error) return result
  const user = await resolveWorkspaceUser(result.user, workspaceId)
  if (!user) return { error: notFound('Workspace not found') }
  if (roles.length > 0 && !roles.includes(user.role)) {
    await audit({
      workspaceId, actorId: user.id, action: 'access.denied', entityType: 'role', entityId: roles.join('|'),
      payload: { reason: 'role', role: user.role },
    })
    return { error: forbidden() }
  }
  return { session: result.session, user }
}

type RouteContext<P> = { params: Promise<P> }

/** Route parameters of a handler under /api/workspaces/[workspaceId]/... */
export type WorkspaceParams = { workspaceId: string; [segment: string]: string }

type WorkspaceHandler<P> = (
  req: NextRequest,
  context: { user: CurrentUser; session: AuthSession; params: P }
) => Promise<Response>

/**
 * A route handler under /api/workspaces/[workspaceId]/...: checks the session,
 * the workspace and the role, then runs the handler inside the workspace's
 * transaction (lib/workspace/db.ts), so db() is scoped to it. Requests other
 * than GET are writes and are refused on an archived workspace.
 *
 * `transaction: false` leaves opening transactions to the handler, for work
 * that must not hold one open (streamed exports, calls to the AI service).
 */
export function workspaceRoute<P extends WorkspaceParams = WorkspaceParams>(
  roles: Role[],
  handler: WorkspaceHandler<P>,
  { transaction = true, timeoutMs }: { transaction?: boolean; timeoutMs?: number } = {}
) {
  return async (req: NextRequest, { params }: RouteContext<P>): Promise<Response> => {
    const resolved = await params
    const { user, session, error } = await requireWorkspace(resolved.workspaceId, ...roles)
    if (error) return error
    const write = req.method !== 'GET' && req.method !== 'HEAD'
    if (write && user.archived) return workspaceArchived()
    if (!transaction) return handler(req, { user, session, params: resolved })
    try {
      return await withWorkspace(user.workspaceId, () => handler(req, { user, session, params: resolved }), { write, timeoutMs })
    } catch (caught) {
      if (caught instanceof WorkspaceArchivedError) return workspaceArchived()
      throw caught
    }
  }
}

export function workspaceArchived() {
  return NextResponse.json({ error: 'This workspace is archived and read-only' }, { status: 409 })
}
