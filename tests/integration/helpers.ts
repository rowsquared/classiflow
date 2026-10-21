import { NextRequest } from 'next/server'
import type { Role } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { AuthSession } from '@/lib/auth'

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

/**
 * A user who is signed in from one browser: the Session row is created with
 * the user, so signInAs() later finds it unless it was revoked since.
 */
export async function createUser(role: Role, opts: { supervisorId?: string | null; mustResetPassword?: boolean } = {}) {
  const username = uid(role)
  return prisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      name: username,
      role,
      supervisorId: opts.supervisorId ?? null,
      mustResetPassword: opts.mustResetPassword ?? false,
      sessions: { create: { token: uid('token'), expiresAt: new Date(Date.now() + 3600_000) } },
    },
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
    include: { user: true },
  })
  if (!session) return null
  const { user, ...rest } = session
  return { session: rest, user } as AuthSession
}

export async function createSentences(count: number, assignTo: string[] = []) {
  const imp = await prisma.sentenceImport.create({ data: { fileName: 'test.csv', totalRows: count } })
  const sentences = []
  for (let i = 0; i < count; i++) {
    sentences.push(await prisma.sentence.create({
      data: {
        importId: imp.id,
        importOrder: i,
        field1: `record ${i}`,
        fieldMapping: { '1': 'text' },
        assignments: { create: assignTo.map(userId => ({ userId })) },
      },
    }))
  }
  return sentences
}

/**
 * Taxonomy with a two-level tree (codes kept as strings with leading zeros):
 *   01 -> 011, 012
 *   02 (leaf)
 */
export async function createTaxonomy(key = uid('tax'), opts: { isActive?: boolean } = {}) {
  const taxonomy = await prisma.taxonomy.create({
    data: { key, maxDepth: 2, isActive: opts.isActive ?? true },
  })
  await prisma.taxonomyNode.createMany({
    data: [
      { taxonomyId: taxonomy.id, code: '01', label: 'Group 01', level: 1, parentCode: null, isLeaf: false },
      { taxonomyId: taxonomy.id, code: '011', label: 'Item 011', level: 2, parentCode: '01', isLeaf: true },
      { taxonomyId: taxonomy.id, code: '012', label: 'Item 012', level: 2, parentCode: '01', isLeaf: true },
      { taxonomyId: taxonomy.id, code: '02', label: 'Group 02', level: 1, parentCode: null, isLeaf: true },
    ],
  })
  return taxonomy
}

export function request(url: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

export function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) }
}
