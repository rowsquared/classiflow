import { execSync } from 'node:child_process'

// The application code under test connects as this least-privilege role, the
// way production runs (scripts/db-runtime-role.ts), so workspace row security
// applies to every test. Fixtures and assertions use the owner (helpers.ts).
export const RUNTIME_ROLE = 'classiflow_suite_app'
export const RUNTIME_PASSWORD = 'suite-runtime-password-1'

/**
 * Applies the committed migrations to TEST_DATABASE_URL before any test runs
 * and creates the runtime role. The database name must end in "_test": every
 * test file truncates all tables.
 */
export default function setup() {
  const url = testDatabaseUrl()
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit'
  })
  execSync('node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/db-runtime-role.ts', {
    env: { ...process.env, DATABASE_URL: url, APP_DB_USER: RUNTIME_ROLE, APP_DB_PASSWORD: RUNTIME_PASSWORD },
    stdio: 'inherit'
  })
}

/** TEST_DATABASE_URL with the runtime role's credentials. */
export function runtimeDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl())
  url.username = RUNTIME_ROLE
  url.password = RUNTIME_PASSWORD
  return url.href
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a disposable database whose name ends in _test, e.g.\n' +
        '  postgresql://classiflow:classiflow_password@localhost:5434/classiflow_test'
    )
  }
  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against "${dbName}": the database name must end in _test`)
  }
  return url
}
