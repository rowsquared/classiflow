// Checks a restored (or any) classiflow database before the app is allowed to
// use it. Run by scripts/restore-drill.sh after a test restore, and by hand
// after a real one (DEPLOYMENT.md "Backups"):
//
//   DATABASE_URL=<schema owner> APP_DB_USER=classiflow_app APP_DB_PASSWORD=... \
//     node scripts/restore-check.ts
//
// 1. Migrations: none failed; prints the latest one.
// 2. Row security: every table with a workspaceId column (other than the
//    control-plane membership table) has row security enabled and a policy.
// 3. Runtime role: creates/updates APP_DB_USER exactly as scripts/start.sh
//    does, then checks it is not a superuser, cannot bypass row security,
//    owns nothing, has row access to every application table, none to the
//    migration history, and may run the AI job recovery function.
// 4. Every workspace: as the runtime role, inside that workspace's context,
//    each workspace table shows exactly the rows the owner sees for it; with
//    no context it sees none. Prints a summary per workspace.
//
// Exits non-zero on any failure. Read-only apart from the role setup.
import { connect, type PrismaClient } from './lib/db.ts'
import { ensureRole, runtimeUrl } from './db-runtime-role.ts'

// Control-plane tables that carry a workspaceId but are deliberately not
// row-secured: membership discovery happens before a workspace is chosen
// (lib/api-auth.ts), invitations are accepted by people who are not members
// yet, and the mail outbox is sent across workspaces (lib/mail/outbox.ts).
const CONTROL_PLANE_TABLES = new Set(['WorkspaceMembership', 'WorkspaceInvitation', 'OutgoingMail'])

type Failure = string
const failures: Failure[] = []
const fail = (message: string) => failures.push(message)
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

async function workspaceTables(owner: PrismaClient): Promise<string[]> {
  const rows = await owner.$queryRaw<Array<{ table: string }>>`
    SELECT c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspaceId' AND NOT a.attisdropped
    WHERE n.nspname = current_schema() AND c.relkind = 'r'
    ORDER BY c.relname`
  return rows.map(row => row.table).filter(table => !CONTROL_PLANE_TABLES.has(table))
}

async function checkMigrations(owner: PrismaClient) {
  const failed = await owner.$queryRaw<Array<{ name: string }>>`
    SELECT migration_name AS name FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL`
  for (const { name } of failed) fail(`migration ${name} is unfinished or failed`)
  const [latest] = await owner.$queryRaw<Array<{ name: string; finished: Date }>>`
    SELECT migration_name AS name, finished_at AS finished FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`
  console.log(latest ? `Latest migration: ${latest.name} (${latest.finished.toISOString()})` : 'No migrations applied')
  if (!latest) fail('no migrations applied')
}

async function checkRowSecurity(owner: PrismaClient, tables: string[]) {
  const rows = await owner.$queryRaw<Array<{ table: string; enabled: boolean; policies: bigint }>>`
    SELECT c.relname AS table, c.relrowsecurity AS enabled,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = ANY(${tables})`
  for (const row of rows) {
    if (!row.enabled) fail(`row security is not enabled on "${row.table}"`)
    if (row.policies === 0n) fail(`"${row.table}" has no row security policy`)
  }
  console.log(`Row security: ${rows.length} workspace tables checked`)
}

async function checkRole(owner: PrismaClient, user: string) {
  const [role] = await owner.$queryRaw<Array<{ superuser: boolean; bypassrls: boolean; createrole: boolean }>>`
    SELECT rolsuper AS superuser, rolbypassrls AS bypassrls, rolcreaterole AS createrole
    FROM pg_roles WHERE rolname = ${user}`
  if (!role) {
    fail(`runtime role "${user}" does not exist`)
    return
  }
  if (role.superuser) fail(`runtime role "${user}" is a superuser`)
  if (role.bypassrls) fail(`runtime role "${user}" can bypass row security`)
  if (role.createrole) fail(`runtime role "${user}" can create roles`)

  const owned = await owner.$queryRaw<Array<{ table: string }>>`
    SELECT tablename AS table FROM pg_tables WHERE schemaname = current_schema() AND tableowner = ${user}`
  for (const { table } of owned) fail(`runtime role owns "${table}" (owners bypass row security)`)

  const missing = await owner.$queryRaw<Array<{ table: string }>>`
    SELECT tablename AS table FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
      AND NOT (has_table_privilege(${user}, format('%I.%I', schemaname, tablename), 'SELECT')
           AND has_table_privilege(${user}, format('%I.%I', schemaname, tablename), 'INSERT')
           AND has_table_privilege(${user}, format('%I.%I', schemaname, tablename), 'UPDATE')
           AND has_table_privilege(${user}, format('%I.%I', schemaname, tablename), 'DELETE'))`
  for (const { table } of missing) fail(`runtime role lacks row access to "${table}"`)

  const [extra] = await owner.$queryRaw<Array<{ migrations: boolean; recovery: boolean; create: boolean }>>`
    SELECT has_table_privilege(${user}, format('%I._prisma_migrations', current_schema()), 'SELECT') AS migrations,
           has_function_privilege(${user}, format('%I.app_recoverable_ai_jobs(timestamp)', current_schema()), 'EXECUTE') AS recovery,
           has_schema_privilege(${user}, current_schema(), 'CREATE') AS "create"`
  if (extra?.migrations) fail('runtime role can read the migration history')
  if (extra?.create) fail('runtime role can create objects in the schema')
  if (!extra?.recovery) fail('runtime role cannot run app_recoverable_ai_jobs (AI job recovery)')
  console.log(`Runtime role "${user}": attributes and grants checked`)
}

async function countByWorkspace(client: PrismaClient, table: string): Promise<Map<string, number>> {
  const rows = await client.$queryRawUnsafe<Array<{ workspaceId: string | null; n: bigint }>>(
    `SELECT "workspaceId", count(*) AS n FROM ${ident(table)} GROUP BY "workspaceId"`
  )
  return new Map(rows.filter(row => row.workspaceId !== null).map(row => [row.workspaceId as string, Number(row.n)]))
}

async function checkWorkspaces(owner: PrismaClient, app: PrismaClient, tables: string[]) {
  const workspaces = await owner.$queryRaw<Array<{ id: string; name: string; status: string }>>`
    SELECT id, name, status::text AS status FROM "Workspace" ORDER BY name, id`
  const ownerCounts = new Map<string, Map<string, number>>()
  for (const table of tables) ownerCounts.set(table, await countByWorkspace(owner, table))

  // No workspace context: the runtime role sees no workspace rows at all.
  for (const table of tables) {
    const [row] = await app.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${ident(table)}`)
    const visible = Number(row?.n ?? 0)
    // Platform audit events (no workspace) stay visible to the app.
    const expected = table === 'AuditLog' ? await platformAuditEvents(owner) : 0
    if (visible !== expected) fail(`"${table}": the runtime role sees ${visible} rows without a workspace context`)
  }

  const summary: Array<Record<string, string | number>> = []
  for (const workspace of workspaces) {
    const seen = await app.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspace.id}, true)`
      const counts = new Map<string, number>()
      for (const table of tables) {
        const [row] = await tx.$queryRawUnsafe<Array<{ n: bigint; foreign: bigint }>>(
          `SELECT count(*) AS n, count(*) FILTER (WHERE "workspaceId" IS DISTINCT FROM $1) AS foreign FROM ${ident(table)}`,
          workspace.id
        )
        if (Number(row?.foreign ?? 0) > 0) fail(`"${table}": workspace ${workspace.id} sees another workspace's rows`)
        counts.set(table, Number(row?.n ?? 0) - Number(row?.foreign ?? 0))
      }
      return counts
    })
    for (const table of tables) {
      const expected = ownerCounts.get(table)?.get(workspace.id) ?? 0
      const visible = seen.get(table) ?? 0
      if (visible !== expected) {
        fail(`"${table}": workspace ${workspace.id} has ${expected} rows, the runtime role sees ${visible}`)
      }
    }
    summary.push({
      workspace: workspace.name,
      status: workspace.status,
      records: seen.get('Sentence') ?? 0,
      labels: seen.get('SentenceAnnotation') ?? 0,
      taxonomies: seen.get('Taxonomy') ?? 0,
      comments: seen.get('Comment') ?? 0
    })
  }
  const [members] = await owner.$queryRaw<Array<{ users: bigint; memberships: bigint }>>`
    SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "WorkspaceMembership") AS memberships`
  console.log(
    `Workspaces: ${workspaces.length}; accounts: ${members?.users ?? 0}; memberships: ${members?.memberships ?? 0}`
  )
  if (summary.length > 0) console.table(summary)
}

async function platformAuditEvents(owner: PrismaClient): Promise<number> {
  const [row] = await owner.$queryRaw<
    Array<{ n: bigint }>
  >`SELECT count(*) AS n FROM "AuditLog" WHERE "workspaceId" IS NULL`
  return Number(row?.n ?? 0)
}

export async function restoreCheck(env = process.env): Promise<string[]> {
  failures.length = 0
  const ownerUrl = env.DATABASE_URL
  const user = env.APP_DB_USER || ''
  const password = env.APP_DB_PASSWORD || ''
  if (!ownerUrl) throw new Error('DATABASE_URL (the schema owner) is not set')
  if (!user || !password) throw new Error('APP_DB_USER and APP_DB_PASSWORD are required (the runtime role to check)')

  await ensureRole({ ownerUrl, user, password })
  const owner = connect(ownerUrl)
  const app = connect(runtimeUrl({ ownerUrl, user, password }))
  try {
    await checkMigrations(owner)
    const tables = await workspaceTables(owner)
    await checkRowSecurity(owner, tables)
    await checkRole(owner, user)
    await checkWorkspaces(owner, app, tables)
  } finally {
    await Promise.all([owner.$disconnect(), app.$disconnect()])
  }
  return [...failures]
}

if (import.meta.main) {
  restoreCheck()
    .then(found => {
      if (found.length === 0) {
        console.log('✓ Restore check passed')
        return
      }
      for (const message of found) console.error(`✗ ${message}`)
      process.exitCode = 1
    })
    .catch(error => {
      console.error('✗ Restore check could not run:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
