# Environment variables

The one reference for classiflow's configuration. Other guides link here
instead of repeating the list. `.env.example` is a starting point for local
Docker Compose; on a server, set the values in your platform's secret store.

**Secret** values must never be committed or logged. Generate secrets with
`openssl rand -base64 32`.

## Database

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes (app outside Compose; Compose builds it) | none | yes | PostgreSQL URL of the **schema owner**: runs migrations and recovery scripts. Local dev: `postgresql://classiflow:classiflow_password@localhost:5434/classiflow?schema=public` |
| `POSTGRES_PASSWORD` | yes, with `docker-compose.yml` | none (Compose refuses to start) | yes | Password of the Compose PostgreSQL service. PostgreSQL keeps the password it was initialised with: changing it later needs `ALTER ROLE` as well |
| `POSTGRES_USER`, `POSTGRES_DB` | no | `classiflow` | no | Compose PostgreSQL user and database |
| `DATABASE_POOL_SIZE` | no | `10` | no | Connections per app instance (`pg` pool, `lib/prisma.ts`). See DEPLOYMENT.md "Running more than one instance" |
| `APP_DB_USER`, `APP_DB_PASSWORD` | yes in production (Compose refuses to start without them) | none | password: yes | Least-privilege role the server runs as, bound by workspace row security; created by `scripts/start.sh`. See DEPLOYMENT.md "Database roles" |
| `ALLOW_OWNER_RUNTIME` | no | unset | no | `true` lets the production server run as the schema owner without `APP_DB_USER`; row security then does not apply. Emergencies only |

## Authentication

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes | none (Compose refuses to start; the server refuses Better Auth's default in production) | yes | Signs session cookies. At least 32 characters. Changing it signs everyone out |
| `BETTER_AUTH_URL` | yes in production | `http://localhost:3000` in Compose | no | Public URL of the app (`https://…`, no trailing path). Better Auth trusts this origin for sign-in requests |
| `SIGN_IN_RATE_LIMIT` | no | `10` | no | Sign-in attempts per client IP per minute, shared by all instances (production only). The IP comes from `X-Forwarded-For` |

## First admin

Used by `scripts/init-admin.ts` only while the database has **no admin**;
changing them later does nothing. To recover access see DEPLOYMENT.md "Admin User".

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `DEFAULT_ADMIN_PASSWORD` | on the first start | none | yes | At least 8 characters; well-known placeholders are refused in production. Must be changed at first sign-in |
| `DEFAULT_ADMIN_USERNAME` | no | `admin` | no | Sign-in name: letters, digits, `.`, `_`, `-`; stored in lower case |
| `DEFAULT_ADMIN_EMAIL` | no | `admin@classiflow.local` (`admin@example.com` in Compose) | no | Sign-in email |
| `DEFAULT_ADMIN_NAME` | no | `System Administrator` (`Admin User` in Compose) | no | Display name |

## AI suggestions (optional)

Leave `AI_LABELING_API_URL` and `AI_LABELING_API_KEY` unset for human-only
labelling; AI features stay disabled. They are set together or not at all.

| Variable | Required | Default (code / Compose) | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `AI_LABELING_API_URL` | for AI | unset | no | Taxomind base URL, including any path prefix such as `/api` |
| `AI_LABELING_API_KEY` | for AI | unset | yes | Bearer token for Taxomind |
| `AI_SOURCE_SLUG` | yes, with AI | none | no | Deployment namespace for Taxomind, e.g. `classiflow-app-rowsquared`. Each workspace uses `<AI_SOURCE_SLUG>--<workspaceId>`, so workspaces never share a model; staging and production need different values |
| `AI_LABELING_BATCH_SIZE` | no | 1000 / 100 | no | Records per labelling job |
| `AI_LEARNING_BATCH_SIZE` | no | 100 / 100 | no | Records per learning job |
| `AI_LEARNING_MIN_NEW_ANNOTATIONS` | no | 500 / 500 | no | New human labels needed before learning can start |
| `AI_JOB_POLL_INTERVAL_MS` | no | 60000 / 5000 | no | Status poll interval; also sets the job lease length (2 × interval + 60 s) |
| `AI_JOB_POLL_TIMEOUT_MS` | no | 18000000 (5 h) / 600000 | no | A job still running after this is marked failed |

## Runtime and build

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `SOURCE_COMMIT` | no (build argument) | empty | no | Commit being built; reported by `/api/health` as `release`. Coolify sets it with "Include Source Commit in Build" |
| `PORT`, `HOSTNAME` | no | `3000`, `0.0.0.0` in the image | no | Listen address of `server.js` |
| `NODE_ENV` | no | `production` in the image | no | Enables production checks (admin password placeholders, auth secret) and the sign-in rate limit |

## Scripts and tests only

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEW_PASSWORD` | `scripts/reset-admin-password.ts` | Temporary password to set (DEPLOYMENT.md "Admin User") |
| `TEST_DATABASE_URL` | `npm run test:integration` | Disposable database whose name ends in `_test` |
