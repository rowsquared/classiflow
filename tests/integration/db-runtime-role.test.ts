import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { testDatabaseUrl } from './global-setup'
import { resetDatabase } from './helpers'

// scripts/db-runtime-role.js as scripts/start.sh runs it: DATABASE_URL is the
// schema owner, the server then connects as APP_DB_USER.
const APP_DB_USER = 'classiflow_runtime_test'
const PASSWORD = 'runtime-test-password-1'

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return execFileSync('node', ['scripts/db-runtime-role.js', ...args], {
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
  app = new PrismaClient({ datasourceUrl: runScript(['--url']) })
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
      data: { username: 'rt', email: 'rt@test.local', name: 'rt', password: 'x', role: 'labeller' },
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
