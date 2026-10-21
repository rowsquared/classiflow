# Deployment Guide

This guide covers production deployment for classiflow. The app provides the UI and database for classification workflows. AI labeling and learning are optional and come from the separate Taxomind service.

## Prerequisites

- Docker (and Docker Compose) or a container platform
- PostgreSQL 16 (the version CI and the Compose file use; others are untested)
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
Compose refuses to start without `POSTGRES_PASSWORD` and `NEXTAUTH_SECRET`; there
are no built-in fallbacks.

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
`DATABASE_URL` (or `POSTGRES_PASSWORD` with Compose), `NEXTAUTH_SECRET`,
`AUTH_URL`/`NEXTAUTH_URL`, and `DEFAULT_ADMIN_PASSWORD` for the first start.

## Running more than one instance

Several app containers can share one database. AI jobs are safe: each job is
held by one instance through a database lease and taken over if that instance
dies (see AGENTS.md "Optional AI integration"). The built-in login throttle is
per instance, so rate-limit `POST /api/auth/callback/credentials` at the proxy.
Size the database's `max_connections` for Prisma's pool per instance.

## Database roles

`DATABASE_URL` is the schema owner: it applies migrations, and recovery scripts
run as it. By default the server uses it too. To run the server with row access
only, set `APP_DB_USER` (a lower-case name different from the owner) and
`APP_DB_PASSWORD` (16+ characters). On every start `scripts/start.sh` then runs
`scripts/db-runtime-role.js`, which creates or updates that role with
`SELECT/INSERT/UPDATE/DELETE` on the application tables (also tables added by
later migrations) and nothing else: no DDL, no `TRUNCATE`, no access to the
migration history. The server and admin bootstrap then connect as that role.
Changing `APP_DB_PASSWORD` and restarting rotates the password. The CI smoke job
runs the stack this way. To go back, unset both variables and restart.

## Upgrading an existing Compose deployment

Earlier versions of `docker-compose.yml` fell back to the public password
`classiflow_password` when `POSTGRES_PASSWORD` was unset. PostgreSQL keeps the
password it was initialised with, so set `POSTGRES_PASSWORD` to the password the
database actually has (`classiflow_password` if it was never set) before
deploying, then rotate it:

```bash
docker compose exec -T postgres psql -U classiflow -d classiflow \
  -c "ALTER ROLE classiflow PASSWORD 'the-new-password'"
```

and set `POSTGRES_PASSWORD` to the new value and redeploy.

## Reverse proxy

- Terminate TLS at the proxy and forward `Host` (or `X-Forwarded-Host`) unchanged: state-changing API calls whose browser `Origin` does not match are refused (403).
- Set a request body limit of at least 50 MB for CSV uploads (the application refuses larger files), and a rate limit on `POST /api/auth/callback/credentials`: the built-in login throttle is per process only.
- Add `Strict-Transport-Security` at the proxy. The app itself sends `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and a report-only `Content-Security-Policy` (see `next.config.ts`; switch it to enforcing once browser consoles in production show no reports).

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

## Admin User

On every start, `scripts/init-admin.js` creates an admin from `DEFAULT_ADMIN_USERNAME` (default `admin`), `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` **only if the database has no admin yet**. The password must be changed at first sign-in. In production the script refuses a missing or well-known placeholder password and stops startup with an error, so set a real one before the first deploy. It never prints the password.

Changing `DEFAULT_ADMIN_PASSWORD` later does **not** change an existing account. To recover a lost admin password, set a temporary one from the server:

```bash
docker compose exec -e NEW_PASSWORD='a-temporary-password' app node scripts/reset-admin-password.js admin
```

The account must change it at next sign-in, and its existing sessions are signed out. Other users are reset by an admin on the Team page.

## Audit log

Admins see an audit trail at **Audit Log** (`/admin/audit`, API `GET /api/audit`):
user, taxonomy, import, assignment, bulk-label, export and AI-job changes, and
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

# Restore drill: restores into a throwaway PostgreSQL 16 container, prints the
# latest migration and row counts, and how long the restore took.
scripts/restore-drill.sh classiflow-2026-10-21.dump
```

Decide and record: how much data loss is tolerable (backup frequency), how long
a restore may take, where encrypted copies live and for how long, and who is
alerted when a backup fails. Run the drill after every change to the backup job
and at least quarterly.

To restore for real, stop the app, restore into an empty database with
`pg_restore --no-owner --no-privileges -U classiflow -d classiflow`, then start
the app: migrations bring an older dump up to date and, with `APP_DB_USER` set,
the runtime role's grants are re-applied.

## Troubleshooting

- **Database does not exist**: Ensure the database is created and the name matches `DATABASE_URL`.
- **AI labeling returns 404**: Verify `AI_LABELING_API_URL` points to the Taxomind service base path.

## Platform Notes

For Coolify-specific instructions, see `COOLIFY_DEPLOYMENT.md`.
