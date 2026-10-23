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

## Demo data (optional)

For staging and demos: `scripts/start.sh` runs `scripts/seed-demo.ts` after the
admin bootstrap. It creates one workspace, "Labour Force Survey 2026 (demo)"
(`demo-lfs`): 3,000 survey answers about jobs, the ISCO-08 and ISIC Rev.4
taxonomies, a team of two supervisors and eight labellers, six weeks of
labelling history, comments, flags and AI suggestions. Platform admins become
its admins. It touches no other workspace or account, and a failed seed does
not stop the server. Do not set it in production.

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `DEMO_SEED` | no | off | no | `true` seeds the demo workspace when it does not exist; `reset` deletes and rebuilds it on every start, which also moves its history up to the current date |
| `DEMO_PASSWORD` | no | none | yes | Password of the demo accounts (`demo.grace` workspace admin, `demo.amina` and `demo.lukas` supervisors, `demo.sofia`, `demo.daniel`, … labellers). Without it they cannot sign in. Set on creation and on `reset` |

Locally: `npm run db:seed-demo` (add `-- --reset` to rebuild). `node
scripts/seed-demo.ts --csv <dir>` writes the same taxonomies and records as
CSV files for the import screens.

## Email (optional)

Mail goes through the rowsquared "E-MAIL API" n8n workflow, which owns the SMTP
credentials (the same variable names as survey-hub). Mail is **on** when
`N8N_EMAIL_WEBHOOK_SECRET` is set and a public base URL is known; otherwise it
is off: no invitation or emailed-password options, no "Forgot password?", and
admins hand over temporary passwords themselves. There is no SMTP transport.
For local testing, `node scripts/mock-mail-webhook.mjs` (DEVELOPMENT.md).

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `N8N_EMAIL_WEBHOOK_SECRET` | for mail | empty (mail off) | yes | Value of the header the workflow checks. Give classiflow its own value so it can be rotated separately |
| `N8N_EMAIL_WEBHOOK_URL` | no | `https://n8n.rowsquared.com/webhook/send-email` | no | Workflow endpoint |
| `N8N_EMAIL_WEBHOOK_HEADER` | no | `send-email-api` | no | Name of the header that carries the secret |
| `N8N_EMAIL_WEBHOOK_TIMEOUT` | no | `15` (seconds) | no | Bound on one delivery; the workflow answers after its SMTP send. No answer in time counts as "unknown" (it may have been sent), never as failed |
| `APP_BASE_URL` | no | `BETTER_AUTH_URL` | no | Public URL used in mail links. Never taken from the request's `Host` header |
| `INVITATION_LINK_HOURS` | no | `72` | no | Lifetime of invitation links (new accounts and workspace invitations) |
| `PASSWORD_RESET_LINK_MINUTES` | no | `60` | no | Lifetime of a password link |
| `MAIL_RETENTION_DAYS` | no | `90` | no | Days sent, failed and unknown rows stay in the mail outbox (`OutgoingMail`) before they are deleted automatically; `0` keeps them. The audit log keeps the mail events |

## AI suggestions (optional)

AI is configured **per workspace** (Admin › AI Settings): a platform admin
approves the Taxomind services workspaces may use (AI services page; open to
every workspace or only to chosen ones), and each
workspace admin connects the workspace to one of them with the workspace's own
access token. The deployment only provides the encryption keys for those tokens
and the namespace. Leave `AI_CREDENTIALS_KEYS` unset for human-only labelling;
AI features stay disabled.

| Variable | Required | Default (code / Compose) | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `AI_CREDENTIALS_KEYS` | for AI | unset | yes | Keys that encrypt the workspaces' access tokens (AES-256-GCM): comma-separated `<keyId>:<base64 of 32 bytes>`, e.g. `k2026a:$(openssl rand -base64 32)`. The first key encrypts, all listed keys decrypt (rotation: DEPLOYMENT.md "AI credentials"). **Back it up separately from the database**: without it the stored tokens are useless |
| `AI_SOURCE_SLUG` | yes, with AI | none | no | Deployment namespace for Taxomind, e.g. `classiflow-app-rowsquared`. Each workspace uses `<AI_SOURCE_SLUG>--<workspaceId>`, so workspaces never share a model; staging and production need different values |
| `AI_LABELING_API_URL` | no | unset | no | Optional: registered once as an *approved* Taxomind service at start-up (base URL including any path prefix such as `/api`). It configures no workspace; each still needs its own connection and token. Platform admins can approve and retire services in the UI instead |
| `AI_MAX_ACTIVE_JOBS_PER_WORKSPACE` | no | 3 | no | AI jobs (labelling, learning, taxonomy sync) one workspace may have running at the AI service; more wait as "pending" |
| `AI_MAX_ACTIVE_JOBS` | no | 10 | no | The same ceiling for the whole deployment; queued jobs are admitted fairly across workspaces |
| `AI_LABELING_BATCH_SIZE` | no | 1000 / 100 | no | Records per labelling job (default; a workspace admin can set its own under Admin › AI Settings) |
| `AI_LEARNING_BATCH_SIZE` | no | 100 / 100 | no | Records per learning job (default, overridable per workspace) |
| `AI_LEARNING_MIN_NEW_ANNOTATIONS` | no | 500 / 500 | no | New human labels needed before learning can start (default, overridable per workspace) |
| `AI_JOB_POLL_INTERVAL_MS` | no | 60000 / 5000 | no | Status poll interval; also sets the job lease length (2 × interval + 60 s) |
| `AI_JOB_POLL_TIMEOUT_MS` | no | 18000000 (5 h) / 600000 | no | A job still running after this is marked failed |

`AI_LABELING_API_KEY` is no longer read: a deployment-wide token would give
every workspace the same Taxomind access. Enter tokens per workspace instead.

## Progress reports

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |

## Runtime and build

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `SOURCE_COMMIT` | no (build argument) | empty | no | Commit being built; reported by `/api/health` as `release`. Coolify sets it with "Include Source Commit in Build" |
| `PORT`, `HOSTNAME` | no | `3000`, `0.0.0.0` in the image | no | Listen address of `server.js` |
| `NODE_ENV` | no | `production` in the image | no | Enables production checks (admin password placeholders, auth secret) and the sign-in rate limit |

## Logs and traces

Logs are JSON lines on stdout (pino, `lib/logger.ts`) with `level`, `time`,
`msg`, `service`, `release` and, during a request, `requestId` (also returned
as the `x-request-id` response header and stored on audit entries). Passwords,
tokens, cookies and record text are redacted if passed by mistake.

| Variable | Required | Default | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `LOG_LEVEL` | no | `info` (`silent` in the test suites) | no | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent` |
| `AUDIT_RETENTION_DAYS` | no | `730` | no | Days audit log entries are kept; each instance deletes older ones every six hours. `0` keeps them forever |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | empty (tracing off) | no | OTLP/HTTP collector base URL, e.g. `http://otel-collector:4318`. When set, `instrumentation.ts` loads the OpenTelemetry SDK (`lib/telemetry.ts`) and Next.js traces requests, route handlers, page renders and server-side `fetch` calls (including the AI service); log lines then carry `traceId`/`spanId`. Unset, the SDK is never loaded |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | no | empty | no | Full traces URL instead of the base URL (`…/v1/traces`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | empty | yes, if it holds a token | Headers for the collector, e.g. `authorization=Bearer …` |
| `OTEL_SERVICE_NAME` | no | `classiflow` | no | Service name on the traces; `service.version` is `SOURCE_COMMIT` |
| `OTEL_SDK_DISABLED` | no | empty | no | `true` turns tracing off even with an endpoint set |
| `NEXT_OTEL_VERBOSE` | no | empty | no | `1` makes Next.js emit more spans (Next.js documentation) |

## Scripts and tests only

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEW_PASSWORD` | `scripts/reset-admin-password.ts` | Temporary password to set (DEPLOYMENT.md "Admin User") |
| `APP_DB_USER`, `APP_DB_PASSWORD` | `scripts/restore-check.ts` | Runtime role to set up and check on a restored database (DEPLOYMENT.md "Backups") |
| `TEST_DATABASE_URL` | `npm run test:integration`, `npm run bench:progress` | Disposable database whose name ends in `_test` (the benchmark reads a database seeded by `scripts/bench/seed-progress.ts`) |
| `BENCH_ITERATIONS`, `BENCH_FILTER`, `BENCH_OUT`, `BENCH_LEGACY` | `npm run bench:progress` | Runs per call (15), only calls whose name contains the text, write the table to a file, module with older report functions to compare (DEVELOPMENT.md "Benchmarks") |
