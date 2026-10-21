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
For local dev, point `DATABASE_URL` at the dev database:
`postgresql://classiflow:classiflow_password@localhost:5434/classiflow?schema=public`.
Review `ENV_SETUP.md` for the full list.

3. Start the database (Postgres 16 on port 5434, data kept in a Docker volume):
```bash
npm run db:up
```

4. Run migrations and create the default admin:
```bash
npm run db:migrate
npm run db:init-admin
```

5. Start the app:
```bash
npm run dev
```

Open http://localhost:3000 and log in with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` from `.env`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server with hot reload |
| `npm test` / `npm run test:watch` | Unit tests (Vitest, `*.test.ts` next to the code) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`next build` skips type errors, so run this) |
| `npm run db:up` / `npm run db:down` | Start / stop the dev database |
| `npx prisma migrate dev --name <change>` | Create a migration after editing `prisma/schema.prisma` |
| `npx prisma studio` | Browse the database in the browser |

To wipe the dev database: `docker compose -f docker-compose.dev.yml down -v`, then `npm run db:up` and rerun the migrations.

## Optional: AI suggestions

classiflow can call Taxomind for AI labeling. To enable it locally, run Taxomind and set `AI_LABELING_API_URL` and `AI_LABELING_API_KEY` in `.env`.

Also set `AI_SOURCE_SLUG` to scope taxonomy keys per deployment. Use the subdomain-domain of your app host (strip `www` and the final TLD, join with `-`). For example, if your app runs at `https://classiflow.app.rowsquared.org`, set `AI_SOURCE_SLUG=classiflow-app-rowsquared`. For local development you can use any slug (e.g. `AI_SOURCE_SLUG=local-dev`).

## Branches and releases

- `staging` is the integration branch and deploys to staging on every push.
- `main` is production. Do not push to it; promote with `node scripts/promote-main.mjs`
  once CI is green on `staging`. See [Deploy triggers](COOLIFY_DEPLOYMENT.md#deploy-triggers).
