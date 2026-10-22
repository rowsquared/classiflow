// Creates or updates a least-privilege PostgreSQL login for the running app.
// Run by scripts/start.sh after migrations when APP_DB_USER is set.
//
// DATABASE_URL must be the schema owner (the role that runs migrations). The
// app role APP_DB_USER (password APP_DB_PASSWORD) gets row access to every
// application table and nothing else, and is bound by the workspace row
// security (it is not the table owner and has NOBYPASSRLS): it cannot create, alter or drop tables,
// cannot touch the migration history, and is not a superuser. Default
// privileges extend the same grants to tables that later migrations create.
// Idempotent; the password is set on every run, so rotating it is a restart.
//
//   node scripts/db-runtime-role.ts          # create/update the role
//   node scripts/db-runtime-role.ts --url    # print DATABASE_URL for that role
import { connect } from './lib/db.ts'

type Config = { ownerUrl: string; user: string; password: string }

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/

function config(): Config {
  const ownerUrl = process.env.DATABASE_URL
  const user = process.env.APP_DB_USER || ''
  const password = process.env.APP_DB_PASSWORD || ''
  if (!ownerUrl) throw new Error('DATABASE_URL (the schema owner) is not set')
  if (!ROLE_NAME.test(user)) {
    throw new Error('APP_DB_USER must be a lower-case PostgreSQL identifier (letters, digits, _)')
  }
  if (password.length < 16) throw new Error('APP_DB_PASSWORD must be at least 16 characters')
  const owner = decodeURIComponent(new URL(ownerUrl).username)
  if (owner === user) throw new Error('APP_DB_USER must differ from the schema owner in DATABASE_URL')
  return { ownerUrl, user, password }
}

/** DATABASE_URL for the app role: the owner URL with other credentials. */
export function runtimeUrl({ ownerUrl, user, password }: Config) {
  const url = new URL(ownerUrl)
  url.username = user
  url.password = password
  return url.href
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

export async function ensureRole({ ownerUrl, user, password }: Config) {
  const prisma = connect(ownerUrl)
  try {
    const [row] = await prisma.$queryRaw<[{ db: string; schema: string }]>`
      SELECT current_database() AS db, current_schema() AS schema`
    const { db, schema } = row
    const role = `"${user}"`
    const exists = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_roles WHERE rolname = ${user}`
    const statements = [
      exists.length === 0 ? `CREATE ROLE ${role} LOGIN` : null,
      `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`,
      `GRANT CONNECT ON DATABASE "${db}" TO ${role}`,
      `REVOKE CREATE ON SCHEMA "${schema}" FROM PUBLIC`,
      `REVOKE CREATE ON SCHEMA "${schema}" FROM ${role}`,
      `GRANT USAGE ON SCHEMA "${schema}" TO ${role}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${role}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${role}`,
      `REVOKE ALL ON TABLE "${schema}"."_prisma_migrations" FROM ${role}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
      // AI job recovery, admission and lease release across workspaces (ids
      // and lease columns only; see the migrations).
      `GRANT EXECUTE ON FUNCTION "${schema}".app_recoverable_ai_jobs(timestamp) TO ${role}`,
      `GRANT EXECUTE ON FUNCTION "${schema}".app_admit_ai_jobs(integer, integer, text, timestamp) TO ${role}`,
      `GRANT EXECUTE ON FUNCTION "${schema}".app_release_ai_leases(text) TO ${role}`,
      // Audit log retention across workspaces (deletes old entries only).
      `GRANT EXECUTE ON FUNCTION "${schema}".app_prune_audit_log(timestamp) TO ${role}`,
      // Queue text search through the trigram indexes, inside the current workspace only.
      `GRANT EXECUTE ON FUNCTION "${schema}".app_search_sentences(text, integer) TO ${role}`
    ].filter((sql): sql is string => sql !== null)
    await prisma.$transaction(statements.map(sql => prisma.$executeRawUnsafe(sql)))
    console.log(`✓ Database role "${user}" has row access to the application tables only`)
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.main) {
  Promise.resolve()
    .then(() => {
      const cfg = config()
      if (process.argv.includes('--url')) {
        process.stdout.write(runtimeUrl(cfg))
        return
      }
      return ensureRole(cfg)
    })
    .catch(error => {
      console.error('✗ Runtime database role setup failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
