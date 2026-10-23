import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/generated/prisma/client'
import type { GlobalUsersQuery } from '@/lib/contracts/users'
import type { DirectoryQuery } from '@/lib/contracts/users'
import type { SessionUser } from '@/lib/api-auth'
import { withWorkspace } from '@/lib/workspace/db'

// The global user directory (platform admins, control plane): one page of
// accounts with their workspace memberships, filtered and counted in the
// database so the list stays fast with many accounts.

const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  banned: true,
  mustResetPassword: true,
  lastLogin: true,
  createdAt: true,
  memberships: {
    select: { role: true, status: true, workspace: { select: { id: true, name: true } } },
    orderBy: { workspace: { name: 'asc' } }
  }
} satisfies Prisma.UserSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>

function toGlobalUser({ role, ...user }: UserRow) {
  return { ...user, platformRole: role }
}

export type GlobalUser = ReturnType<typeof toGlobalUser>

export function globalUsersWhere(query: Omit<GlobalUsersQuery, 'page' | 'pageSize'>): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = []
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    and.push({ OR: [{ name: contains }, { email: contains }, { username: contains }] })
  }
  const workspaceRole = query.role && query.role !== 'platform_admin' ? query.role : undefined
  if (query.workspace === 'none') {
    and.push({ role: 'user', memberships: { none: { status: 'active' } } })
  } else if (query.workspace) {
    const membership = { memberships: { some: { workspaceId: query.workspace, status: 'active' as const } } }
    // Platform admins have every workspace, unless a workspace role is asked for.
    and.push(workspaceRole ? membership : { OR: [{ role: 'admin' }, membership] })
  }
  if (query.role === 'platform_admin') and.push({ role: 'admin' })
  else if (workspaceRole) {
    and.push({
      memberships: {
        some: {
          status: 'active',
          role: workspaceRole,
          ...(query.workspace && query.workspace !== 'none' ? { workspaceId: query.workspace } : {})
        }
      }
    })
  }
  if (query.state === 'active') and.push({ OR: [{ banned: false }, { banned: null }] })
  if (query.state === 'disabled') and.push({ banned: true })
  if (query.state === 'must_reset') and.push({ mustResetPassword: true })
  return { AND: and }
}

export async function listGlobalUsers(query: GlobalUsersQuery) {
  const where = globalUsersWhere(query)
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ role: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    })
  ])
  return { users: users.map(toGlobalUser), total, page: query.page, pageSize: query.pageSize }
}

export async function getGlobalUser(id: string): Promise<GlobalUser | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect })
  return user ? toGlobalUser(user) : null
}

export async function lookupGlobalAccount(email: string) {
  return prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, banned: true }
  })
}

/** Only control-plane workspace/membership data; never infer this from the selected workspace. */
export async function userDirectoryScope(actor: SessionUser) {
  const workspaces = await prisma.workspace.findMany({
    where:
      actor.platformRole === 'admin'
        ? {}
        : {
            memberships: { some: { userId: actor.id, status: 'active', role: 'admin' } }
          },
    select: { id: true, name: true, status: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }]
  })
  return { platform: actor.platformRole === 'admin', workspaces }
}

type DirectoryScope = Awaited<ReturnType<typeof userDirectoryScope>>

/** Prisma cannot filter relation counts in orderBy; sort the same active team count the UI displays. */
async function activeTeamPage(query: DirectoryQuery, workspaceId: string) {
  const { db } = await import('@/lib/workspace/db')
  const conditions = [Prisma.sql`m."workspaceId" = ${workspaceId}`]
  if (query.access !== 'all')
    conditions.push(Prisma.sql`m.status::text = ${query.access === 'removed' ? 'suspended' : 'active'}`)
  if (query.role) conditions.push(Prisma.sql`m.role::text = ${query.role}`)
  if (query.supervisor) conditions.push(Prisma.sql`s."userId" = ${query.supervisor}`)
  if (query.q) {
    const pattern = `%${query.q}%`
    conditions.push(Prisma.sql`(u.name ILIKE ${pattern} OR u.email ILIKE ${pattern} OR u.username ILIKE ${pattern})`)
  }
  if (query.state === 'active') conditions.push(Prisma.sql`u.banned IS DISTINCT FROM TRUE`)
  if (query.state === 'disabled') conditions.push(Prisma.sql`u.banned = TRUE`)
  if (query.setup === 'password') conditions.push(Prisma.sql`u."mustResetPassword" = TRUE`)
  if (query.setup === 'invited')
    conditions.push(Prisma.sql`u."invitedAt" IS NOT NULL AND u."invitationAcceptedAt" IS NULL`)
  if (query.activity === 'never') conditions.push(Prisma.sql`m."lastSeenAt" IS NULL`)
  else if (query.activity) {
    const since = new Date(Date.now() - (query.activity === 'not-seen-30' ? 30 : 7) * 86400000)
    conditions.push(
      query.activity === 'seen-7'
        ? Prisma.sql`m."lastSeenAt" >= ${since}`
        : Prisma.sql`(m."lastSeenAt" IS NULL OR m."lastSeenAt" < ${since})`
    )
  }
  return db().$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT m."userId" FROM "WorkspaceMembership" m JOIN "User" u ON u.id = m."userId"
    LEFT JOIN "WorkspaceMembership" s ON s.id = m."supervisorMembershipId" AND s."workspaceId" = m."workspaceId"
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY (SELECT count(*) FROM "WorkspaceMembership" r WHERE r."workspaceId" = m."workspaceId" AND r."supervisorMembershipId" = m.id AND r.status = 'active') ${query.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`}, m.id ASC
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)
}

function directoryWhere(query: DirectoryQuery, scope: DirectoryScope): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = []
  if (!scope.platform) and.push({ memberships: { some: { workspaceId: { in: scope.workspaces.map(w => w.id) } } } })
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    and.push({ OR: [{ name: contains }, { email: contains }, { username: contains }] })
  }
  if (query.state === 'active') and.push({ OR: [{ banned: false }, { banned: null }] })
  if (query.state === 'disabled') and.push({ banned: true })
  if (query.setup === 'password') and.push({ mustResetPassword: true })
  if (query.setup === 'invited') and.push({ invitedAt: { not: null }, invitationAcceptedAt: null })
  if (query.workspace === 'none') and.push({ role: 'user', memberships: { none: { status: 'active' } } })
  else if (query.workspace) {
    const membership: Prisma.WorkspaceMembershipWhereInput = { workspaceId: query.workspace }
    if (query.access !== 'all') membership.status = query.access === 'removed' ? 'suspended' : 'active'
    if (query.role) membership.role = query.role
    if (query.supervisor) membership.supervisor = { userId: query.supervisor }
    if (query.activity === 'never') membership.lastSeenAt = null
    else if (query.activity) {
      const date = new Date(Date.now() - (query.activity === 'not-seen-30' ? 30 : 7) * 86400000)
      if (query.activity === 'seen-7') membership.lastSeenAt = { gte: date }
      else membership.OR = [{ lastSeenAt: null }, { lastSeenAt: { lt: date } }]
    }
    // The operational view lists actual members, including explicit platform-admin memberships.
    and.push({ memberships: { some: membership } })
  }
  return { AND: and }
}

const directorySelect = (scope: DirectoryScope) =>
  ({
    id: true,
    name: true,
    email: true,
    username: true,
    role: true,
    banned: true,
    mustResetPassword: true,
    lastLogin: true,
    invitedAt: true,
    invitationAcceptedAt: true,
    memberships: {
      where: scope.platform ? {} : { workspaceId: { in: scope.workspaces.map(w => w.id) } },
      select: {
        id: true,
        role: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        workspace: { select: { id: true, name: true, status: true } },
        supervisor: { select: { user: { select: { id: true, name: true } } } },
        _count: { select: { reports: { where: { status: 'active' as const } } } }
      },
      orderBy: { workspace: { name: 'asc' as const } }
    }
  }) satisfies Prisma.UserSelect

export async function listDirectoryUsers(query: DirectoryQuery, scope: DirectoryScope) {
  const where = directoryWhere(query, scope)
  const totalAvailable = await prisma.user.count({
    where: directoryWhere(
      {
        ...query,
        q: '',
        role: undefined,
        state: undefined,
        setup: undefined,
        supervisor: undefined,
        activity: undefined,
        access: 'all'
      },
      scope
    )
  })
  const direction = query.direction
  const workspaceId = query.workspace && query.workspace !== 'none' ? query.workspace : null
  if (workspaceId) {
    // Sort and paginate memberships in the database; do not page each workspace and merge.
    return withWorkspace(workspaceId, async () => {
      const { db } = await import('@/lib/workspace/db')
      const orderBy: Prisma.WorkspaceMembershipOrderByWithRelationInput =
        query.sort === 'role'
          ? { role: direction }
          : query.sort === 'supervisor'
            ? { supervisor: { user: { name: direction } } }
            : query.sort === 'team'
              ? { reports: { _count: direction } }
              : query.sort === 'assigned'
                ? { assignments: { _count: direction } }
                : query.sort === 'lastSeen'
                  ? { lastSeenAt: { sort: direction, nulls: 'last' } }
                  : {
                      user:
                        query.sort === 'lastLogin'
                          ? { lastLogin: { sort: direction, nulls: 'last' } }
                          : { [query.sort === 'email' ? 'email' : 'name']: direction }
                    }
      const teamPage = query.sort === 'team' ? await activeTeamPage(query, workspaceId) : null
      const memberships = await db().workspaceMembership.findMany({
        where: { workspaceId, user: where, ...(teamPage ? { userId: { in: teamPage.map(row => row.userId) } } : {}) },
        orderBy: [orderBy, { id: 'asc' }],
        skip: teamPage ? undefined : (query.page - 1) * query.pageSize,
        take: teamPage ? undefined : query.pageSize,
        select: { user: { select: directorySelect(scope) }, _count: { select: { assignments: true } } }
      })
      const total = await db().workspaceMembership.count({ where: { workspaceId, user: where } })
      return {
        users: (teamPage
          ? teamPage.flatMap(row => memberships.filter(m => m.user.id === row.userId))
          : memberships
        ).map(m => ({ ...m.user, assigned: m._count.assignments })),
        total,
        totalAvailable,
        page: query.page,
        pageSize: query.pageSize
      }
    })
  }
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: directorySelect(scope),
      orderBy: [
        { [query.sort === 'email' ? 'email' : query.sort === 'lastLogin' ? 'lastLogin' : 'name']: direction },
        { id: 'asc' }
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    })
  ])
  return {
    users: users.map(user => ({ ...user, assigned: null })),
    total,
    totalAvailable,
    page: query.page,
    pageSize: query.pageSize
  }
}

export async function getDirectoryUser(userId: string, scope: DirectoryScope) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      ...directoryWhere(
        { q: '', workspace: '', access: 'all', sort: 'name', direction: 'asc', page: 1, pageSize: 50 },
        scope
      )
    },
    select: directorySelect(scope)
  })
}
