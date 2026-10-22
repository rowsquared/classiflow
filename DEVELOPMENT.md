# Development Setup

This guide is for developers who want to run classiflow locally from source.
The app runs on the host (`next dev`, hot reload); only PostgreSQL runs in Docker.

## Prerequisites

- Node.js 24 LTS (see `.nvmrc`; `nvm use` picks it) and npm 11+
- Docker (for the dev database)

## Setup

1. Clone and install:
```bash
git clone https://github.com/rowsquared/classiflow.git
cd classiflow
npm ci
```
`npm ci` installs exactly what `package-lock.json` records, as CI and the
Docker image do. Add or upgrade a dependency with `npm install <pkg>@<version>`
and commit `package.json` and `package-lock.json` together.

2. Configure environment:
```bash
cp .env.example .env
```
The template's `DATABASE_URL` already points at the dev database (port 5434).
Set `BETTER_AUTH_SECRET` and `DEFAULT_ADMIN_PASSWORD`; leave the AI variables
commented out unless you run Taxomind. Every variable is in `ENV_SETUP.md`.

3. Start the database (PostgreSQL 18 on port 5434, data kept in a Docker volume):
```bash
npm run db:up
```

4. Run migrations and create the default admin (set `DEFAULT_ADMIN_PASSWORD` in
   `.env` first; both commands read `.env`):
```bash
npm run db:migrate
npm run db:init-admin
```

5. Start the app:
```bash
npm run dev
```

Open http://localhost:3000 and sign in with `DEFAULT_ADMIN_USERNAME` (or `DEFAULT_ADMIN_EMAIL`) and `DEFAULT_ADMIN_PASSWORD` from `.env`.

For data to click through, `npm run db:seed-demo` adds a demo workspace with
3,000 coded survey records and a team (`DEMO_PASSWORD` in `.env` lets you sign
in as its members; ENV_SETUP.md "Demo data").

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server with hot reload |
| `npm test` / `npm run test:watch` | Unit tests (Vitest, `*.test.ts` next to the code) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check with the native TypeScript 7 compiler (fast; the build uses TypeScript 6) |
| `npm run db:up` / `npm run db:down` | Start / stop the dev database |
| `npx prisma migrate dev --name <change>` | Create a migration after editing `prisma/schema.prisma`; then `npx prisma generate` (Prisma 7 no longer regenerates the client by itself) |
| `npx prisma studio` | Browse the database in the browser |

### Benchmarks

The progress reports and the queue search have a repeatable benchmark on
seeded data (docs/archive/plans-2026-10/progress-dashboard.md records the results):

```bash
createdb classiflow_bench_test     # once; _bench or _test, the seed empties every table
export TEST_DATABASE_URL=postgresql://classiflow:classiflow_password@localhost:5434/classiflow_bench_test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
DATABASE_URL=$TEST_DATABASE_URL node scripts/bench/seed-progress.ts --records 50000
npm run bench:progress             # p50/p95, SQL statements and response size per call
```

Run it on a quiet machine; numbers from a busy laptop are only good for comparisons
within one run.

To wipe the dev database: `docker compose -f docker-compose.dev.yml down -v`, then `npm run db:up` and rerun the migrations.

## Optional: AI suggestions

classiflow can call Taxomind for AI labeling. To enable it locally, run Taxomind, set `AI_CREDENTIALS_KEYS` (e.g. `local:$(openssl rand -base64 32)`) and optionally `AI_LABELING_API_URL` (registered as an approved service) in `.env`, then connect a workspace with your Taxomind token under Admin › AI Settings and turn AI on there.

Also set `AI_SOURCE_SLUG` to scope taxonomy keys per deployment. Use the subdomain-domain of your app host (strip `www` and the final TLD, join with `-`). For example, if your app runs at `https://classiflow.app.rowsquared.org`, set `AI_SOURCE_SLUG=classiflow-app-rowsquared`. For local development you can use any slug (e.g. `AI_SOURCE_SLUG=local-dev`).

## Optional: email

Mail is off by default (ENV_SETUP.md "Email"). To try invitations, password
links and emailed passwords locally, run the mock workflow and point the app
at it:

```bash
N8N_EMAIL_WEBHOOK_SECRET=dev-only-secret node scripts/mock-mail-webhook.mjs
# in .env:
N8N_EMAIL_WEBHOOK_SECRET="dev-only-secret"
N8N_EMAIL_WEBHOOK_URL="http://localhost:4010/webhook/send-email"
```

The mock prints each mail's recipient, subject and links (marked dev only),
never the rest of the body. `MOCK_MAIL_STATUS=500` makes it fail, to see the
"unknown" outcome on the Team page.

## Branches and releases

- `staging` is the integration branch and deploys to staging on every push.
- `main` is production. Do not push to it; promote with `node scripts/promote-main.mjs`
  once CI is green on `staging`. See [Deploy triggers](COOLIFY_DEPLOYMENT.md#deploy-triggers).
