# Agent guide

## What this repository is

The product is **classiflow**, an open-source, self-hosted platform for labeling
text records against hierarchical classifications such as ISCO, ISIC, and COICOP.

Users import records and taxonomies, assign work to labellers, select hierarchical
labels, flag records, discuss them in comments, track progress, and export CSVs.
AI suggestions and learning are optional integrations with the separate
[Taxomind service](https://github.com/rowsquared/taxomind). This repository owns
the UI, application API, workflow, and database; model training/inference live in
Taxomind. Human labeling works without an AI service.

## Architecture at a glance

```text
Browser: React client components
  -> Next.js App Router pages / app/api/**/route.ts
     -> Prisma -> PostgreSQL
     -> Taxomind HTTP API (optional)
        -> in-process polling monitors -> persisted job state / AI suggestions
```

- One Next.js application, not a monorepo or a separate frontend/backend pair.
- Stack: Next.js 15, React 19, strict TypeScript, Prisma 6.17.1, PostgreSQL,
  Auth.js / NextAuth v5 beta, Tailwind CSS v4. Check `package.json` for exact
  dependency versions; keep Prisma CLI and client versions aligned.
- Most business logic and database queries are in route handlers. `lib/` contains
  shared infrastructure and AI integration; there is no general service layer.
- Many list/dashboard pages are server components that load initial data through
  `lib/server-fetch.ts` and pass it to a colocated `*Client.tsx` component.
  Interactive components then use browser `fetch` and React hooks for updates.
  Some pages, including the individual labeling screen, are entirely client-side.
- `serverFetchJSON` forwards the current request's cookies, defaults to
  `cache: 'no-store'`, and returns `null` on failure. Preserve authentication and
  fallback behavior when changing server-side data loading.

## Where to look

| Area | Entry points and responsibilities |
| --- | --- |
| Application shell | `app/layout.tsx`, `components/Sidebar.tsx`, `components/SessionProvider.tsx`; `/` redirects to `/queue` |
| Work queue | `app/queue/page.tsx`, `app/queue/QueuePageClient.tsx`, `components/queue/`; filtering, sorting, pagination, selection, bulk labels, assignments |
| Individual labeling | `app/queue/[sentenceId]/page.tsx`, `components/TaxonomyBrowser.tsx`; hierarchical selection, suggestions, keyboard navigation, comments, flags |
| Taxonomy browsing | `app/taxonomies/[key]/page.tsx` |
| Administration | `app/admin/taxonomy/`, `sentences/`, `team/`, `export/`, `ai-jobs/`; `/admin` redirects to `/admin/taxonomy` |
| Progress | `app/progress/`, `app/api/progress/{stats,timeline,team}/`; counts, timelines, team metrics |
| Record APIs | `app/api/sentences/`; queue queries, stats, imports, assignment, bulk labels, individual records/annotations/comments/flags |
| Other data APIs | `app/api/taxonomies/`, `app/api/imports/`, `app/api/users/`, `app/api/export/` |
| AI APIs | `app/api/ai-labeling/` starts labeling, learning, external training; `app/api/ai-jobs/` provides combined history, active jobs, cancellation |
| Authentication | `lib/auth.config.ts`, `lib/auth.ts`, `middleware.ts`, `types/next-auth.d.ts`, `app/api/auth/` |
| Database | `prisma/schema.prisma`, `prisma/migrations/`, shared client in `lib/prisma.ts` |
| Shared presentation | `styles/globals.css`, `components/`, `lib/utils.ts`, assets in `public/` |
| Operations | `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/`, `scripts/` (`init-admin.js` runs on every start, `reset-admin-password.ts`, `promote-main.mjs`) |

## Domain model and behavior to preserve

Read `prisma/schema.prisma` before changing data behavior.

- **Sentence** means an imported record, not necessarily a grammatical sentence.
  `SentenceImport` groups a CSV upload; `importOrder` preserves row order.
  Records have up to five `fieldN` values to classify and five `supportN` context
  values. JSON `fieldMapping` / `supportMapping` retain original column names.
- **Taxonomy** has a unique public `key`, a database `id`, custom level names,
  and a maximum depth of five. Current creation/UI logic limits the app to three
  taxonomies. `TaxonomyNode` is unique by `(taxonomyId, code)`; `parentCode`
  describes the hierarchy. Definitions, examples, and synonyms support labeling.
- **Codes are strings.** Preserve leading zeros through CSV parsing, database
  writes, UI state, exports, and AI payloads. Do not convert classification codes
  to numbers. Unknown values are level-specific: `-9`, `-99`, `-999`, `-9999`,
  `-99999`. Use helpers in `lib/constants.ts`; older comments sometimes mention
  only `-99`.
- **Human annotations and AI suggestions are distinct.** `SentenceAnnotation`
  stores labels, their source, author, and labeling timestamps.
  `SentenceAISuggestion` stores a suggestion and confidence per
  `(sentenceId, taxonomyId, level)`. Some API responses merge these for display;
  AI suggestions alone must not count as human completion.
- The individual annotation endpoint replaces annotations for the selected
  taxonomy while retaining the others. It computes `submitted` when all active
  taxonomies have annotations, otherwise `pending`; skipping sets `skipped`.
  The UI enforces leaf/unknown selection. The bulk endpoint currently sets
  `submitted` directly, so inspect both paths when changing completion behavior.
  `escalated` also exists in the schema; flags are a separate boolean.
- `SentenceAssignment` joins records and users. Roles are `admin`, `supervisor`,
  and `labeller`; users can have a supervisor and subordinate labellers. Queue,
  detail, stats, and progress queries apply role/team scoping in their handlers.
  Keep those views consistent when changing visibility or assignment rules.
- Comments have resolution state; last-editor and labeling timestamps feed UI
  and progress reporting. Annotation writes also update the taxonomy's
  `newAnnotationsSinceLastLearning` counter.
- `AuditLog` exists in the schema; do not assume every mutation writes one.

### CSV boundaries

- Record import accepts an optional `id`, one to five `field_*` columns, and up
  to five `support_*` columns. `app/api/sentences/import/route.ts` supports a dry
  run; the admin UI validates before committing.
- Taxonomy CSV uses `id`, `label`, `parent_id`, `level`, plus optional
  `definition`, `examples`, and `synonyms`. Creation, validation, and imports into
  an existing taxonomy have separate handlers; check all relevant paths.
- Export includes original field/support names, human labels as
  `{taxonomyKey}_{level}`, and AI codes/confidences as `{taxonomyKey}_ai{level}`
  and `{taxonomyKey}_ai{level}c`. Record import does not accept all export columns;
  a full export is not directly round-trippable through that importer.

## Authentication and authorization

Credentials login accepts username or email, checks a bcrypt password hash, and
uses JWT sessions. Session/JWT fields include user ID, role, and
`mustResetPassword`. `lib/auth.ts` refreshes user fields on session updates.

`middleware.ts` redirects unauthenticated page requests and enforces the initial
password reset flow. **It explicitly passes API requests through.** API handlers
must perform their own session and role checks: start every handler with
`requireSession()` from `lib/api-auth.ts` (any signed-in user) or
`requireSession('admin')` (listed roles only). Do not infer protection from an
`/admin` UI, middleware, or neighboring endpoint. Record-level scoping (which
sentences a labeller may see) is applied in the queue/stats handlers only.

## Optional AI integration

- `lib/ai-labeling.ts` is the HTTP boundary: bearer-token requests, request
  timeouts, external job creation/status/cancellation, and older polling helpers.
  AI features require `AI_LABELING_API_URL` and `AI_LABELING_API_KEY`.
- `lib/ai-utils.ts` builds named field payloads from `fieldN` / `fieldMapping`.
  `AI_SOURCE_SLUG` scopes taxonomy keys for a deployment; preserve it in AI
  payloads. Batch sizes, thresholds, and polling settings live in
  `lib/constants.ts`; Compose/environment defaults can differ from code defaults.
- Labeling (`/api/ai-labeling/jobs`) and learning (`/api/ai-labeling/learn`)
  resolve records, create one database job per batch, and launch monitors from
  `lib/ai-job-monitor.ts`. Jobs run concurrently; Taxomind handles its own queue.
  Monitors persist external IDs, progress, completion/failure, and labeling
  suggestions. Learning uses submitted user annotations and a minimum-new-labels
  threshold.
- Monitor bookkeeping is a process-local global set, not a durable worker or
  distributed lock. `ensureJobsMonitored()` recovers pending/processing labeling
  and learning jobs when the active-jobs API is polled, with a rate limit.
  Consider process restarts and multiple app instances before changing this.
- Taxonomy sync uses `Taxonomy.lastAISync*` fields and the older monitor helper.
- External training (uploading a training CSV) was removed; its UI and API are
  gone. `AIExternalTrainingJob` stays in the schema only so historical jobs still
  show in the AI jobs list and taxonomy deletes clean them up.

## Local development and checks

Use Node.js 20+ and npm 10+. `.npmrc` enables legacy peer dependencies, disables
the lockfile, and saves exact versions. Follow the existing npm setup; do not
introduce a different package manager or lockfile incidentally.

1. `npm install` (postinstall generates the Prisma client).
2. Copy `.env.example` to `.env` if no local environment exists; configure
   `DATABASE_URL`, auth URL/secret settings, and default-admin settings. See
   `DEVELOPMENT.md` and `ENV_SETUP.md`. Leave AI unconfigured for human-only work.
3. `npm run db:up` starts the development PostgreSQL 16 container on host port
   **5434**. Point the host app's database URL there, as shown in `DEVELOPMENT.md`.
4. `npm run db:migrate` applies committed migrations. Initialize the admin with
   `npm run db:init-admin` when environment variables are already loaded, or
   `node --env-file=.env scripts/init-admin.js` to load the file explicitly.
   The plain Node script does not load `.env` itself. It creates a missing admin
   and leaves existing accounts/passwords unchanged.
5. `npm run dev` starts Next.js at `http://localhost:3000`.

| Check | Command / scope |
| --- | --- |
| TypeScript | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` |
| Unit tests | `npm test`; Vitest config in `vitest.config.ts`, colocated `*.test.ts` / `*.test.tsx`, Node environment |
| Production build | `npm run build` (Prisma generation + Next build) |
| New schema migration | Edit schema, then `npx prisma migrate dev --name <change>` against a development database; commit generated SQL |

`next.config.ts` skips TypeScript and ESLint errors during production builds.
A successful build therefore does not establish type/lint correctness. Run
checks relevant to a code change and distinguish pre-existing failures from
regressions.
`db:seed` is listed in the manifest but currently has no configured Prisma seed.

Production uses Next's standalone output in a Node 20 Alpine image. The Compose
startup command applies migrations, initializes the admin, then runs `server.js`;
the Dockerfile alone only starts `server.js`. Production Compose leaves app/DB
ports internal for reverse-proxy hosting. `/api/health` checks database
connectivity. See `DEPLOYMENT.md`, `COOLIFY_DEPLOYMENT.md`, and the actual workflow
files for deployment details; these are separate from the local dev stack.

## Working conventions

- Inspect `git status` before editing. Multiple agents may share this checkout;
  preserve unrelated changes and keep edits scoped to the requested task.
- Commit only the files you changed (`git add <paths>`, never `git add -A`).
- Work lands on `staging`, which deploys to staging on push. Never push or merge
  into `main`: production is released only with `node scripts/promote-main.mjs`
  after CI is green on `staging` (a ruleset enforces this). See "Deploy
  triggers" in `COOLIFY_DEPLOYMENT.md`.
- Use the `@/` root import alias and existing component/route conventions. Keep
  Prisma, auth internals, and AI credentials on the server; interactive React
  files use `'use client'`. App Router dynamic route `params` are promises.
- Reuse the Prisma singleton from `lib/prisma.ts` for application data access.
  Keep related label/comment/status writes transactional where they already are.
- Tailwind v4 configuration is CSS-based in `styles/globals.css`. Its `indigo`
  palette is deliberately remapped to teal; preserve the established theme.
- UI and route response types are often defined locally, and response envelopes
  vary (`ok`, `success`, or bare data). Update callers alongside handler changes;
  do not assume a universal response format.
- Do not edit generated `.next/`, Prisma client output, or `node_modules/`.
  Inspect maintenance scripts before running them: many update real database
  records or credentials. Keep secrets and generated/imported datasets out of
  commits.
- Keep this guide aligned with architecture/workflow changes. For a focused
  task, read the relevant code and linked docs rather than treating this overview
  as a complete specification.

For hardening and modernization work, start with the
[repository review](docs/reviews/2026-10-21-review.md), then read only the relevant
linked investigation brief. These are dated findings and proposed work, not
implemented behavior or additional standing instructions.
