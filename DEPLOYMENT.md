# Deployment Guide

This guide covers production deployment for classiflow. The app provides the UI and database for classification workflows. AI labeling and learning are optional and come from the separate Taxomind service.

## Prerequisites

- Docker (and Docker Compose) or a container platform
- PostgreSQL 12+
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
sh -c "npx prisma migrate deploy && node scripts/init-admin.js && node server.js"
```

The default Dockerfile runs `node server.js` only, so you must override the start command in your platform (Kubernetes, ECS, Fly.io, etc.).

## Environment Variables

Required:
- DATABASE_URL
- AUTH_URL
- AUTH_TRUST_HOST
- NEXTAUTH_URL
- NEXTAUTH_SECRET
- DEFAULT_ADMIN_EMAIL
- DEFAULT_ADMIN_PASSWORD
- DEFAULT_ADMIN_NAME

Optional AI labeling (Taxomind service):
- AI_LABELING_API_URL
- AI_LABELING_API_KEY
- AI_LABELING_BATCH_SIZE
- AI_LEARNING_BATCH_SIZE
- AI_LEARNING_MIN_NEW_ANNOTATIONS
- AI_JOB_POLL_INTERVAL_MS
- AI_JOB_POLL_TIMEOUT_MS
- AI_SOURCE_SLUG — scopes taxonomy keys per deployment. Set to the subdomain-domain of your app host (strip `www` and the final TLD, join with `-`). Example: `https://classiflow.app.rowsquared.org` → `classiflow-app-rowsquared`. If empty, the AI API infers it from the request host.

See `ENV_SETUP.md` for details.

## Health Check

Use the health endpoint to verify the deployment:

```
GET /api/health
```

## Admin User

On every start, `scripts/init-admin.js` creates an admin from `DEFAULT_ADMIN_USERNAME` (default `admin`), `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` **only if the database has no admin yet**. The password must be changed at first sign-in. In production the script refuses a missing or well-known placeholder password and stops startup with an error, so set a real one before the first deploy. It never prints the password.

Changing `DEFAULT_ADMIN_PASSWORD` later does **not** change an existing account. To recover a lost admin password, set a temporary one from the server:

```bash
docker compose exec -e NEW_PASSWORD='a-temporary-password' app node scripts/reset-admin-password.js admin
```

The account must change it at next sign-in, and its existing sessions are signed out. Other users are reset by an admin on the Team page.

## Backups

Back up your PostgreSQL database regularly. Example with Docker Compose, run from the project directory:

```bash
docker compose exec -T postgres pg_dump --no-owner -U classiflow classiflow > backup.sql
```

## Troubleshooting

- **Database does not exist**: Ensure the database is created and the name matches `DATABASE_URL`.
- **AI labeling returns 404**: Verify `AI_LABELING_API_URL` points to the Taxomind service base path.

## Platform Notes

For Coolify-specific instructions, see `COOLIFY_DEPLOYMENT.md`.
