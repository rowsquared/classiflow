const runtimeRole = 'classiflow_e2e_app'
const runtimePassword = 'browser-suite-runtime-only'

export const runtimeRoleEnv = { APP_DB_USER: runtimeRole, APP_DB_PASSWORD: runtimePassword }

export function fixtureDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set (a disposable database whose name ends in _test)')
  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to seed "${dbName}": the database name must end in _test`)
  return url
}

export function browserDatabaseUrl(ownerUrl: string | undefined): string {
  if (!ownerUrl) return ''
  const url = new URL(ownerUrl)
  url.username = runtimeRole
  url.password = runtimePassword
  return url.href
}
