import { execSync } from 'node:child_process'

/**
 * Applies the committed migrations to TEST_DATABASE_URL before any test runs.
 * The database name must end in "_test": every test file truncates all tables.
 */
export default function setup() {
  const url = testDatabaseUrl()
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
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
