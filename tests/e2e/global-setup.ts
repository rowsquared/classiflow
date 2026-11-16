import { execSync } from 'node:child_process'
import { fixtureDatabaseUrl, runtimeRoleEnv } from './database.ts'

/** Migrates E2E_DATABASE_URL (name must end in _test), empties it and seeds the journeys' data (seed.ts). */
function setupDatabase() {
  const env = { ...process.env, DATABASE_URL: fixtureDatabaseUrl() }
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' })
  execSync('node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/db-runtime-role.ts', {
    env: { ...env, ...runtimeRoleEnv },
    stdio: 'inherit'
  })
}

setupDatabase()
