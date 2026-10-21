import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma/client'
import { createPrismaClient } from '@/lib/prisma'
import { testDatabaseUrl } from './global-setup'
import { prisma, resetDatabase } from './helpers'

// scripts/db-runtime-role.ts as scripts/start.sh runs it: DATABASE_URL is the
// schema owner, the server then connects as APP_DB_USER.
const APP_DB_USER = 'classiflow_runtime_test'
const PASSWORD = 'runtime-test-password-1'

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return execFileSync('node', ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/db-runtime-role.ts', ...args], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), APP_DB_USER, APP_DB_PASSWORD: PASSWORD, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const PERMISSION_DENIED = /permission denied|must be owner/

let app: PrismaClient

beforeAll(async () => {
  await resetDatabase()
  runScript()
  app = createPrismaClient(runScript(['--url']))
})

afterAll(async () => {
  await app?.$disconnect()
})

describe('least-privilege runtime database role', () => {
  it('connects as the app role, not the owner', async () => {
    const [row] = await app.$queryRaw<Array<{ user: string; superuser: boolean; createrole: boolean }>>`
      SELECT current_user AS user, rolsuper AS superuser, rolcreaterole AS createrole
      FROM pg_roles WHERE rolname = current_user`
    expect(row).toEqual({ user: APP_DB_USER, superuser: false, createrole: false })
  })

  it('reads, writes and locks application rows', async () => {
    const user = await app.user.create({
      data: { username: 'rt', email: 'rt@test.local', name: 'rt', role: 'user' },
    })
    await app.user.update({ where: { id: user.id }, data: { name: 'renamed' } })
    // Annotation saves lock records with SELECT ... FOR UPDATE.
    await app.$transaction(tx => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`)
    expect((await app.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('renamed')
    await app.user.delete({ where: { id: user.id } })
  })

  it('cannot change the schema or empty tables wholesale', async () => {
    await expect(app.$executeRawUnsafe('CREATE TABLE "Intruder" (id int)')).rejects.toThrow(PERMISSION_DENIED)
    await expect(app.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN intruder int')).rejects.toThrow(PERMISSION_DENIED)
    await expect(app.$executeRawUnsafe('DROP TABLE "Comment"')).rejects.toThrow(PERMISSION_DENIED)
    await expect(app.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('sees workspace rows only inside a transaction opened for that workspace', async () => {
    // Two workspaces with one record each, written as the owner.
    const [w1, w2] = await Promise.all(['RLS 1', 'RLS 2'].map(name => prisma.workspace.create({ data: { name } })))
    for (const w of [w1, w2]) {
      const imp = await prisma.sentenceImport.create({ data: { workspaceId: w.id, fileName: 'x.csv', totalRows: 1 } })
      await prisma.sentence.create({
        data: { workspaceId: w.id, recordKey: '1', importId: imp.id, importOrder: 1, field1: 'x', fieldMapping: {} },
      })
    }
    const count = () => app.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Sentence"`

    // No workspace context: nothing is visible, and nothing can be written.
    expect((await count())[0]?.n).toBe(0n)
    await expect(app.$executeRaw`
      INSERT INTO "SentenceImport" (id, "workspaceId", "fileName", "totalRows") VALUES ('x', ${w1.id}, 'x', 0)`
    ).rejects.toThrow(/row-level security/)

    // Inside w1's transaction: w1's record only, and no write into w2.
    await app.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${w1.id}, true)`
      const rows = await tx.$queryRaw<Array<{ workspaceId: string }>>`SELECT "workspaceId" FROM "Sentence"`
      expect(rows).toEqual([{ workspaceId: w1.id }])
    })
    await expect(app.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${w1.id}, true)`
      await tx.$executeRaw`UPDATE "Sentence" SET "workspaceId" = ${w2.id}`
    })).rejects.toThrow(/row-level security/)

    // The setting is transaction-local: a reused connection forgets it.
    expect((await count())[0]?.n).toBe(0n)
  })

  it('cannot read or rewrite the migration history', async () => {
    await expect(app.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('gets the same access to tables that later migrations create', async () => {
    await prisma.$executeRawUnsafe('CREATE TABLE "zz_future_migration" (id int)')
    try {
      await app.$executeRawUnsafe('INSERT INTO "zz_future_migration" VALUES (1)')
      await expect(app.$queryRawUnsafe('SELECT id FROM "zz_future_migration"')).resolves.toEqual([{ id: 1 }])
    } finally {
      await prisma.$executeRawUnsafe('DROP TABLE "zz_future_migration"')
    }
  })

  it('is idempotent', () => {
    expect(runScript()).toContain(APP_DB_USER)
  })

  it('refuses the schema owner, unsafe names and short passwords', () => {
    const owner = decodeURIComponent(new URL(testDatabaseUrl()).username)
    expect(() => runScript([], { APP_DB_USER: owner })).toThrow(/must differ from the schema owner/)
    expect(() => runScript([], { APP_DB_USER: 'app"; DROP TABLE "User' })).toThrow(/identifier/)
    expect(() => runScript([], { APP_DB_PASSWORD: 'short' })).toThrow(/at least 16/)
  })
})
