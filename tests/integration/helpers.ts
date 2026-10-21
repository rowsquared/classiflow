import { NextRequest } from 'next/server'
import type { WorkspaceRole as Role, Sentence } from '@/lib/generated/prisma/client'
import { createPrismaClient } from '@/lib/prisma'
import { testDatabaseUrl } from './global-setup'
import { withWorkspace } from '@/lib/workspace/db'
import type { AuthSession } from '@/lib/auth'

/**
 * The schema owner, for fixtures, truncation and assertions: it sees every
 * workspace's rows. Application code under test uses lib/prisma.ts, which
 * connects as the runtime role (setup.ts).
 */
export const prisma = createPrismaClient(testDatabaseUrl())

let counter = 0
const uid = (prefix: string) => `${prefix}${++counter}_${Date.now().toString(36)}`

/** Empties every application table. Only ever runs against a *_test database. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`)
}

let workspaceId: string | null = null

/** The workspace the test file works in; every file chooses one explicitly. */
export function selectWorkspace(id: string) {
  workspaceId = id
}

function currentWorkspace(): string {
  if (!workspaceId) throw new Error('Call selectWorkspace() (or createWorkspace()) in this test file first')
  return workspaceId
}

/** A new workspace, selected for the following helpers. */
export async function createWorkspace(name = uid('workspace')) {
  const workspace = await prisma.workspace.create({ data: { name } })
  selectWorkspace(workspace.id)
  return workspace
}

/**
 * A user who is signed in from one browser (the Session row is created with
 * the user, so signInAs() later finds it unless it was revoked since) and a
 * member of the current workspace with `role`. supervisorId is a user id.
 */
export async function createUser(
  role: Role,
  opts: {
    supervisorId?: string | null
    mustResetPassword?: boolean
    platformAdmin?: boolean
    workspaceId?: string
  } = {}
) {
  const username = uid(role)
  const ws = opts.workspaceId ?? currentWorkspace()
  const supervisor = opts.supervisorId
    ? await prisma.workspaceMembership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws, userId: opts.supervisorId } }
      })
    : null
  return prisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      name: username,
      role: opts.platformAdmin ? 'admin' : 'user',
      mustResetPassword: opts.mustResetPassword ?? false,
      sessions: { create: { token: uid('token'), expiresAt: new Date(Date.now() + 3600_000) } },
      memberships: { create: { workspaceId: ws, role, supervisorMembershipId: supervisor?.id ?? null } }
    }
  })
}

// Only the id matters: role and reset flag are read from the database, as in
// production, whatever the test passes here.
type SessionUser = { id: string; role?: string }

let currentUserId: string | null = null

/** Makes getSession() return this user's oldest live session, or none. */
export function signInAs(user: SessionUser | null) {
  currentUserId = user?.id ?? null
}

/** What lib/auth.ts getSession() returns for the user chosen with signInAs(). */
export async function sessionFor(): Promise<AuthSession | null> {
  if (!currentUserId) return null
  const session = await prisma.session.findFirst({
    where: { userId: currentUserId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    include: { user: true }
  })
  if (!session) return null
  const { user, ...rest } = session
  return { session: rest, user } as AuthSession
}

/** `N` items as a tuple when `N` is a literal, so `const [a, b] = ...` needs no checks. */
type Many<T, N extends number, R extends T[] = []> = number extends N
  ? T[]
  : R['length'] extends N
    ? R
    : Many<T, N, [...R, T]>

/** Records in the current workspace, assigned to the given users (user ids). */
export async function createSentences<N extends number>(count: N, assignTo: string[] = []): Promise<Many<Sentence, N>> {
  const ws = currentWorkspace()
  const memberships = await prisma.workspaceMembership.findMany({
    where: { workspaceId: ws, userId: { in: assignTo } },
    select: { id: true }
  })
  const imp = await prisma.sentenceImport.create({ data: { workspaceId: ws, fileName: 'test.csv', totalRows: count } })
  const sentences: Sentence[] = []
  for (let i = 0; i < count; i++) {
    sentences.push(
      await prisma.sentence.create({
        data: {
          workspaceId: ws,
          recordKey: uid('record'),
          importId: imp.id,
          importOrder: i,
          field1: `record ${i}`,
          fieldMapping: { '1': 'text' },
          assignments: { create: memberships.map(m => ({ membershipId: m.id })) }
        }
      })
    )
  }
  return sentences as Many<Sentence, N>
}

/**
 * Taxonomy with a two-level tree (codes kept as strings with leading zeros):
 *   01 -> 011, 012
 *   02 (leaf)
 */
export async function createTaxonomy(key = uid('tax'), opts: { isActive?: boolean } = {}) {
  const ws = currentWorkspace()
  const taxonomy = await prisma.taxonomy.create({
    data: { workspaceId: ws, key, maxDepth: 2, isActive: opts.isActive ?? true }
  })
  const node = (code: string, label: string, level: number, parentCode: string | null, isLeaf: boolean) => ({
    workspaceId: ws,
    taxonomyId: taxonomy.id,
    code,
    label,
    level,
    parentCode,
    isLeaf
  })
  await prisma.taxonomyNode.createMany({
    data: [
      node('01', 'Group 01', 1, null, false),
      node('011', 'Item 011', 2, '01', true),
      node('012', 'Item 012', 2, '01', true),
      node('02', 'Group 02', 1, null, true)
    ]
  })
  return taxonomy
}

export function request(url: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' }
  })
}

/** Route context for a handler under /api/workspaces/[workspaceId]: the current workspace plus `value`. */
export function params<T extends Record<string, string>>(value?: T) {
  return {
    params: Promise.resolve({ workspaceId: currentWorkspace(), ...(value ?? {}) } as { workspaceId: string } & T)
  }
}

/** Route context for a handler outside the workspace tree (platform APIs). */
export function plainParams<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) }
}

/**
 * Runs direct database work in the current workspace's transaction: db()
 * there stamps and filters workspaceId the way the application does.
 */
export function inWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  return withWorkspace(currentWorkspace(), fn)
}

/** The current test workspace's id. */
export function wsId(): string {
  return currentWorkspace()
}
