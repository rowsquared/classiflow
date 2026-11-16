import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { runtimeDatabaseUrl, testDatabaseUrl } from './global-setup'
import { prisma, resetDatabase } from './helpers'

// scripts/restore-check.ts as the restore drill runs it against a restored database.
function runCheck(): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'node',
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/restore-check.ts'],
      {
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl(),
          APP_DB_USER: 'classiflow_restore_check_test',
          APP_DB_PASSWORD: 'restore-check-test-password'
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    return { ok: true, output }
  } catch (error) {
    const { stdout, stderr } = error as { stdout: string; stderr: string }
    return { ok: false, output: `${stdout}${stderr}` }
  }
}

beforeAll(async () => {
  await resetDatabase()
  for (const name of ['Restore A', 'Restore B']) {
    const w = await prisma.workspace.create({ data: { name } })
    const imp = await prisma.sentenceImport.create({ data: { workspaceId: w.id, fileName: 'x.csv', totalRows: 2 } })
    for (const key of ['001', '002']) {
      await prisma.sentence.create({
        data: { workspaceId: w.id, recordKey: key, importId: imp.id, importOrder: 1, field1: 'x', fieldMapping: {} }
      })
    }
    await prisma.auditLog.create({
      data: { workspaceId: w.id, action: 'records.imported', entityType: 'import', entityId: imp.id }
    })
  }
  // A platform event (no workspace) stays visible outside workspace context.
  await prisma.auditLog.create({ data: { action: 'workspace.created', entityType: 'workspace', entityId: 'x' } })
})

describe('restore check', () => {
  it('creates one admin when two instances bootstrap concurrently', async () => {
    const run = promisify(execFile)
    const [first, second] = await Promise.all(
      ['first', 'second'].map(name =>
        run(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/init-admin.ts'], {
          env: {
            ...process.env,
            DATABASE_URL: runtimeDatabaseUrl(),
            DEFAULT_ADMIN_USERNAME: `bootstrap-${name}`,
            DEFAULT_ADMIN_EMAIL: `bootstrap-${name}@example.test`,
            DEFAULT_ADMIN_PASSWORD: 'a-forest-of-quiet-elm-trees'
          }
        })
      )
    )
    expect([first!.stdout, second!.stdout].filter(output => output.includes('already exists'))).toHaveLength(1)
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1)
  })
  it('passes on a healthy database and reports every workspace', () => {
    const { ok, output } = runCheck()
    expect(output).toContain('Restore check passed')
    expect(ok).toBe(true)
    expect(output).toContain('Restore A')
    expect(output).toContain('Restore B')
    expect(output).toMatch(/Latest migration: \d{14}_/)
  })

  it('fails when a workspace table has lost its row security', async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE "Comment" DISABLE ROW LEVEL SECURITY')
    try {
      const { ok, output } = runCheck()
      expect(ok).toBe(false)
      expect(output).toContain('row security is not enabled on "Comment"')
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY')
    }
  })
})
