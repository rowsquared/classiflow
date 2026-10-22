import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma/client'
import type { GlobalUsersQuery } from '@/lib/contracts/users'

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
