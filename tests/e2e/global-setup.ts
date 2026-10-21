import { execSync } from 'node:child_process'

/** Migrates E2E_DATABASE_URL (name must end in _test), empties it and seeds the journeys' data (seed.ts). */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set (a disposable database whose name ends in _test)')
  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to seed "${dbName}": the database name must end in _test`)

  const env = { ...process.env, DATABASE_URL: url }
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' })
  execSync('node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/seed.ts', { env, stdio: 'inherit' })
}
