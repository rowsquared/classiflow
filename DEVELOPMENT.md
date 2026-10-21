# Development Setup

This guide is for developers who want to run classiflow locally from source.

## Prerequisites

- Node.js 18+
- PostgreSQL 12+
- npm 10+

## Setup

1. Clone and install:
```bash
git clone https://github.com/rowsquared/classiflow.git
cd classiflow
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```
Update values in `.env` and review `ENV_SETUP.md` for the full list.

3. Run migrations:
```bash
npm run db:migrate
```

4. Start the app:
```bash
npm run dev
```

Open http://localhost:3000.

Note: `npm run dev` currently sets a local `DATABASE_URL` in `package.json`. If you want `.env` to control it, remove that inline value or run `DATABASE_URL=... npm run dev`.

## Optional: AI suggestions

classiflow can call Taxomind for AI labeling. To enable it locally, run Taxomind and set `AI_LABELING_API_URL` and `AI_LABELING_API_KEY` in `.env`.

Also set `AI_SOURCE_SLUG` to scope taxonomy keys per deployment. Use the subdomain-domain of your app host (strip `www` and the final TLD, join with `-`). For example, if your app runs at `https://classiflow.app.rowsquared.org`, set `AI_SOURCE_SLUG=classiflow-app-rowsquared`. For local development you can use any slug (e.g. `AI_SOURCE_SLUG=local-dev`).
