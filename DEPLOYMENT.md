# Deployment Guide

This guide covers production deployment for classiflow. The app provides the UI and database for classification workflows. AI labeling and learning are optional and come from the separate Taxomind service.

## Prerequisites

- Docker (and Docker Compose) or a container platform
- PostgreSQL 18 (the version CI and the Compose files use; others are untested)
- A domain with HTTPS (recommended for production)
- Environment variables (see below)

## Option 1: Docker Compose (app + Postgres)

Use this when you want the app and database deployed together.

1. Clone the repository:
```bash
git clone https://github.com/rowsquared/classiflow.git
cd classiflow
```

2. Copy the environment template and set secure values:
```bash
cp .env.example .env
```
Compose refuses to start without `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`,
`APP_DB_USER` and `APP_DB_PASSWORD`;
there are no built-in fallbacks.

3. Start the stack:
```bash
docker compose up -d --build
```

4. Open your domain or http://localhost:3000, log in, and change the default admin password.

Note: For local access you must expose port 3000 in `docker-compose.yml`. For production behind a reverse proxy, you can keep ports internal and route traffic through your proxy.

## Option 2: App container + external Postgres

Use this when you already manage PostgreSQL elsewhere.

1. Set `DATABASE_URL` to point at your Postgres instance.
2. Provide all required auth and admin environment variables.
3. Ensure the container start command runs migrations and initializes the admin user:

```bash
sh scripts/start.sh
```

It applies migrations, optionally sets up the runtime database role (see
[Database roles](#database-roles)), creates the first admin and starts the server.
The default Dockerfile runs `node server.js` only, so you must override the start command in your platform (Kubernetes, ECS, Fly.io, etc.).

## Environment Variables

See [ENV_SETUP.md](ENV_SETUP.md) for every variable. Required in production:
`DATABASE_URL` (or `POSTGRES_PASSWORD` with Compose), `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, and `DEFAULT_ADMIN_PASSWORD` for the first start.

## Running more than one instance

Several app containers can share one database. AI jobs are safe: each job is
held by one instance through a database lease, given back when the instance is
stopped (SIGTERM) and taken over if it dies (see AGENTS.md "Optional AI
integration"). The AI job ceilings (`AI_MAX_ACTIVE_JOBS*`) hold across
instances. Sessions and the sign-in rate
limit live in the database, so they are shared too.

Connection budget: each instance opens up to `DATABASE_POOL_SIZE` connections
(default 10; Prisma 7 uses the `pg` driver's pool, `lib/prisma.ts`), and the
start scripts briefly one more each. Keep instances × `DATABASE_POOL_SIZE` plus
room for migrations, backups and `psql` below PostgreSQL's `max_connections`
(100 by default).

## Database roles

`DATABASE_URL` is the schema owner: it applies migrations, and recovery scripts
run as it. The server itself **must** run as a separate least-privilege role:
workspace isolation relies on PostgreSQL row-level security, which binds that
role but not the table owner (docs/security.md "Workspaces"). Set `APP_DB_USER`
(a lower-case name different from the owner) and `APP_DB_PASSWORD` (16+
characters); in production `scripts/start.sh` refuses to start without them
(`ALLOW_OWNER_RUNTIME=true` overrides this, for emergencies only). On every
start `scripts/start.sh` runs
`scripts/db-runtime-role.ts`, which creates or updates that role with
`SELECT/INSERT/UPDATE/DELETE` on the application tables (also tables added by
later migrations) and nothing else: no DDL, no `TRUNCATE`, no access to the
migration history, no bypass of row security. It may also call the narrow
AI job functions (recovery, admission, lease release), which return ids only. The server and admin bootstrap then connect as
that role. Changing `APP_DB_PASSWORD` and restarting rotates the password. The
CI smoke job and the integration tests run this way.

## AI credentials

Each workspace's Taxomind access token is stored encrypted (AES-256-GCM) with
the keys in `AI_CREDENTIALS_KEYS` (ENV_SETUP.md). The database alone holds no
usable token, and the keys alone hold no data:

- **Back up the keys separately from the database** (a password manager or the
  secret store of the hosting platform). A restored database without its keys
  needs every workspace admin to enter the token again (AI Settings); nothing
  else is lost.
- **Rotate a key:** generate one (`echo "k2027:$(openssl rand -base64 32)"`),
  put it *first* in `AI_CREDENTIALS_KEYS`, keep the old one after it, and
  restart. Then re-encrypt what is stored and check that nothing still uses the
  old key:

  ```bash
  docker compose exec app node scripts/rotate-ai-credentials.ts
  docker compose exec app node scripts/rotate-ai-credentials.ts --check
  ```

  Remove the old key and restart. (The script runs as the schema owner, which
  sees every workspace's connections; it never prints a token.)
- A connection version that was replaced keeps its token only while jobs that
  started with it are running; the next settings change erases it.
- Taxomind services must be approved by a platform admin (Workspaces page)
  before a workspace can use them. Requests to them do not follow redirects.

## Reverse proxy

- Terminate TLS at the proxy and forward `Host` (or `X-Forwarded-Host`) unchanged: state-changing API calls whose browser `Origin` does not match are refused (403).
- Set a request body limit of at least 50 MB for CSV uploads (the application refuses larger files). The app rate-limits sign-in per client IP itself (`SIGN_IN_RATE_LIMIT`), reading the IP from `X-Forwarded-For`, so the proxy must set that header (and strip any value the client sent). A proxy rate limit on `POST /api/auth/sign-in/*` is still a sensible second layer.
- Add `Strict-Transport-Security` at the proxy. The app itself sends `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (`next.config.ts`) and an enforced, nonce-based `Content-Security-Policy` (`proxy.ts`).

## Mail

Optional. With `N8N_EMAIL_WEBHOOK_SECRET` set (ENV_SETUP.md "Email") classiflow
sends invitations, password links, emailed temporary passwords and account
notices through the rowsquared n8n "E-MAIL API" workflow; the workflow must
accept classiflow's secret. Links use `APP_BASE_URL` (or `BETTER_AUTH_URL`),
never the request's host, so set it to the public `https://` address.

- **Outbox:** every mail is a row in `OutgoingMail` (purpose, status, timestamps;
  never the body, a link, a token or a password). It is sent right after the
  request that queued it; a timer in each instance (once a minute) sends rows a
  restart left behind and marks rows stuck while sending as **unknown** (they
  may have arrived; they are never resent automatically). Several instances are
  safe: a row is claimed with one conditional update before it is sent.
- **Outcomes** on the Team page: sent, failed (the workflow refused it; resending
  is safe), unknown (timeout or server error). Emailed temporary passwords are
  never retried or stored; after a failure send a password link instead.
- **Retention:** `OutgoingMail` rows are only needed for recent status. Each
  instance deletes sent, failed and unknown rows older than
  `MAIL_RETENTION_DAYS` (default 90; `0` keeps them) once an hour. The mail
  events stay in the audit log.
- **Check it:** sign in, open Team, create a test member with "Email a link to
  choose a password", and look for "email sent" in the member's drawer.

## Health Check

Use the health endpoint to verify the deployment:

```
GET /api/health
```

It answers 200 with `"database": "connected"` and `"release": "<commit>"` (the
`SOURCE_COMMIT` build argument, `null` when the build did not pass it), or 503
when the database does not answer. Compare `release` with the commit you meant
to deploy; with the repository variable `PROD_HEALTH_URL` set, the CI
`deploy-prod` job waits for production to report the promoted commit.

## Logs, request IDs and traces

The app logs JSON lines to stdout (collect them with the platform's container
logs). Every request gets an ID: a well-formed `X-Request-ID` from the reverse
proxy is kept (8–128 letters, digits, `.`, `_`, `:` or `-`), otherwise one is
generated. It comes back as the `x-request-id` response header, appears on
that request's log lines and is stored on its audit entries (`requestId`), so
a reported error can be traced from the audit log to the logs. AI jobs keep the
ID of the request that started them and send it to Taxomind as `x-request-id`
on every call (cancelling sends the cancelling request's). Unhandled
errors in workspace API routes are logged with it and answered with a plain
500. Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` points at an OTLP/HTTP
collector (ENV_SETUP.md "Logs and traces").

## Container hardening

`docker-compose.yml` runs the app with no Linux capabilities, no privilege
escalation and a **read-only root filesystem**. Only `/tmp` and
`/app/.next/cache` (Next's cache, created at start) are writable, both in
memory. The start script calls the Prisma CLI directly rather than through
`npx`, because npm would write its cache and logs under `$HOME`. Checked by
running `prisma migrate deploy` and the standalone server on a read-only
mount. If a future change needs to write files, give it its own tmpfs or
volume rather than dropping `read_only`. Memory and CPU limits are left as
commented placeholders: size them from production usage.

## Admin User

On every start, `scripts/init-admin.ts` creates an admin from `DEFAULT_ADMIN_USERNAME` (default `admin`), `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` **only if the database has no admin yet**. The password must be changed at first sign-in. In production the script refuses a missing or well-known placeholder password and stops startup with an error, so set a real one before the first deploy. It never prints the password.

Changing `DEFAULT_ADMIN_PASSWORD` later does **not** change an existing account. To recover a lost admin password, set a temporary one from the server:

```bash
docker compose exec -e NEW_PASSWORD='a-temporary-password' app node scripts/reset-admin-password.ts admin
```

The account must change it at next sign-in, its existing sessions are signed out, and a ban on it is lifted. Other users are reset by an admin on the Team page, or, with mail on, choose a new password themselves ("Forgot password?" on the sign-in page).

## Audit log

Admins see an audit trail at **Audit Log** (`/admin/audit`, API `GET /api/audit`):
user, membership, invitation, member import, mail (admin-requested mail and
its outcome), taxonomy, import, assignment, bulk-label, export and AI-job changes, and
refused access (`access.denied`, by role or by record scope). Each entry has
actor (name kept after the user is deleted), action, object and time; details
hold identifiers and counts, never record text or passwords. Individual label
saves, comments and flags are not audited: those rows carry their own author
and timestamps.

Entries are kept until you delete them. Choose a retention period and prune,
for example monthly:

```bash
docker compose exec -T postgres psql -U classiflow -d classiflow \
  -c "DELETE FROM \"AuditLog\" WHERE \"createdAt\" < now() - interval '2 years'"
```

## Backups

All state is in PostgreSQL (uploads are parsed into the database; nothing on the
app container's disk needs backing up). Take custom-format dumps, keep them off
the host, encrypted, and restore one regularly:

```bash
# Backup, from the project directory (or the Coolify server)
docker compose exec -T postgres pg_dump -U classiflow -Fc classiflow > classiflow-$(date +%F).dump

# Restore drill, from a checkout of the deployed commit after `npm ci`:
# restores into a throwaway PostgreSQL 18 container, prints the latest
# migration and row counts and how long the restore took, then runs
# scripts/restore-check.ts against it (below).
scripts/restore-drill.sh classiflow-2026-10-21.dump
```

`scripts/restore-check.ts` fails the drill unless: no migration failed; every
table with a `workspaceId` (except the `WorkspaceMembership` control-plane
table) has row security enabled and a policy; the runtime role, set up as the
start script does, is not a superuser, cannot bypass row security, owns no
table, has row access to every application table, none to the migration
history, and may run the AI job recovery function; and, for every workspace,
the runtime role inside that workspace's context sees exactly the owner's rows
of each workspace table (and none without a context). It prints a summary per
workspace (records, labels, taxonomies, comments).

Decide and record: how much data loss is tolerable (backup frequency), how long
a restore may take, where encrypted copies live and for how long, and who is
alerted when a backup fails. Run the drill after every change to the backup job
and at least quarterly.

To restore for real, stop the app, restore into an empty database with
`pg_restore --no-owner --no-privileges -U classiflow -d classiflow`, then start
the app: migrations bring an older dump up to date and, with `APP_DB_USER` set,
the runtime role's grants are re-applied. Then run the same checks against it
before opening it to users:

```bash
docker compose exec app node scripts/restore-check.ts   # uses the container's DATABASE_URL, APP_DB_USER, APP_DB_PASSWORD
```

## Troubleshooting

- **Database does not exist**: Ensure the database is created and the name matches `DATABASE_URL`.
- **AI labeling returns 404**: Verify the approved service's base URL (Workspaces page) points to the Taxomind base path, including a prefix such as `/api`.
- **AI jobs stay "pending"**: the workspace or the deployment is at its job ceiling (`AI_MAX_ACTIVE_JOBS_PER_WORKSPACE`, `AI_MAX_ACTIVE_JOBS`), or `AI_CREDENTIALS_KEYS` is not set on the instance (then no instance runs AI jobs).

## Platform Notes

For Coolify-specific instructions, see `COOLIFY_DEPLOYMENT.md`.
