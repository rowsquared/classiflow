const runtimeRole = 'classiflow_e2e_app'
const runtimePassword = 'browser-suite-runtime-only'

export const runtimeRoleEnv = { APP_DB_USER: runtimeRole, APP_DB_PASSWORD: runtimePassword }

export function browserDatabaseUrl(ownerUrl: string | undefined): string {
  if (!ownerUrl) return ''
  const url = new URL(ownerUrl)
  url.username = runtimeRole
  url.password = runtimePassword
  return url.href
}
