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
- Stack: Next.js 16 (Turbopack, React Compiler), React 19, strict TypeScript
  (6.0 for the build, the native 7.0 compiler for `npm run typecheck`), Prisma 7
  with the `pg` driver adapter, PostgreSQL 18, Better Auth, Tailwind CSS v4.
  Check `package.json` for exact versions; keep `prisma`, `@prisma/client` and
  `@prisma/adapter-pg` on the same version.
- The Prisma client is generated into `lib/generated/prisma` (git-ignored; import
  from `@/lib/generated/prisma/client`, not `@prisma/client`). `lib/prisma.ts`
  owns the shared client and pool size.
- Data loading for the server pages lives in `lib/server/*` (`import 'server-only'`):
  `sentences` (queue filters, list, stats), `progress`, `taxonomies`, `users`,
  `imports`, `ai-jobs`. Each function takes the `CurrentUser` and applies its
  scope itself. The matching GET route handlers are thin wrappers around the same
  functions; server pages call them directly, pass the result through `asJson()`
  (`lib/server/json.ts`, the JSON shape the client components expect) and render
  `components/LoadError.tsx` when loading fails. Other handlers still hold their
  business logic; move it to `lib/server/` when you touch it.
- Query schemas shared by handlers and pages go in `lib/contracts/` (zod 4).
  Response envelopes vary (`ok`, `success`, bare data); update callers with any
  handler change.
- Interactive `*Client.tsx` components then keep their data up to date with
  **TanStack Query** (see "Frontend conventions"). Some pages, including the
  individual labeling screen, are entirely client-side.

### Frontend conventions

- **Data:** TanStack Query. `components/QueryProvider.tsx` holds one cache per
  workspace page tree; the workspace layout keys it by workspace, user and
  role, so nothing fetched under one scope is shown under another, and sign-out
  clears it. Keys come from `lib/query/keys.ts` and always start with
  `['ws', workspaceId]` (except the control-plane workspace list and
  `/accounts`, which has its own provider outside any workspace); query
  functions use `fetchJson` (`lib/query/fetch.ts`: passes the abort signal,
  throws `HttpError` on non-2xx). Pass server-rendered data as `initialData`
  only when the query's parameters match what the server loaded (the queue
  compares parameter strings). After a write, invalidate the affected prefix
  (`queryKeys.queue(workspaceId)` after labels, flags or assignments). Use
  `refetchInterval` for polling (it pauses in hidden tabs), `keepPreviousData`
  plus `useLastSuccessful` (`lib/query/use-last-successful.ts`) where a failed
  refresh must keep the last results on screen. Do not hand-roll `setInterval`
  polling, abort controllers or "latest request" guards in new code.
- **URL state:** nuqs (`useQueryStates`, adapter in the workspace layout). A
  screen's parsers live in a shared module the server page also reads with
  `createLoader` (queue: `lib/queue-url.ts`, whose parameter names are the
  API's), so the server renders the view the URL names. Client-only views keep
  their parsers next to them (Team: `lib/team-url.ts`; audit log: in its
  page). Use `history: 'push'`
  for deliberate view changes (tab, filters, page), the default replace for
  typing.
- **Widgets:** Radix primitives. `components/ui/Combobox.tsx` (searchable
  single choice, ARIA combobox on a Radix popover) for user, label and other
  pickers; Radix `DropdownMenu` for menus; `components/Modal.tsx` for dialogs;
  native `<select>` with a `<label>` where search is not needed. Keep the teal
  theme (`indigo-*` is teal; white text needs `indigo-600` or darker).
- **Look (rowsquared design system):** square corners (the theme sets every
  radius to 2px), flat panels with a hairline and no shadow, shadow only on
  floating layers, Inter at 400/500/600 (no bold), sentence case everywhere
  including buttons, headings and table headers. Use the class helpers in
  `components/ui/styles.ts` (`buttonClass`, `panelClass`, `dialogPanelClass`,
  `badgeClass`) instead of long class strings; one primary button per view.
  Dialogs use `Modal`'s default overlay (`bg-black/50`); `bg-opacity-*` does
  not exist in Tailwind v4. Icons come from `lucide-react`. Form controls use
  `border-gray-500` (3:1 on white) and focus rings are `focus-visible:`.
- **Effects:** the React Compiler lint rules flag state synced in effects and
  refs read during render. Derive values while rendering, key a component to
  reset its state (the labelling screen is keyed by record, the filter panel
  by the applied filters), or adjust state during render; per-browser
  preferences use `useStoredBoolean` (`lib/use-local-storage.ts`).
- **Accessibility:** `tests/e2e/accessibility.spec.ts` runs axe-core on the
  main pages and dialogs and fails on serious or critical findings; add a page
  there when you add one. White text needs `indigo-600` or darker, body text
  `gray-600` or darker on white; every input and select has a label.

## Global user management

Platform admins manage global users at `/team` (`/accounts` redirects there).
The user editor manages workspace roles and supervisors through the existing
workspace member APIs; `components/team/WorkspaceAccess.tsx` is the global
membership editor and `lib/server/memberships.ts` owns attaching existing users.
New global users can be created with email and name (a legacy username is generated).
Workspace invitations support token-gated new-account setup at
`/api/invitations/setup`; public unrestricted sign-up remains disabled.

## Where to look

| Area | Entry points and responsibilities |
| --- | --- |
| Application shell | `app/layout.tsx` (CSP nonce), `app/w/[workspaceId]/layout.tsx` (workspace access, query cache, nuqs adapter, sidebar), `components/Sidebar.tsx`, `components/WorkspaceSwitcher.tsx`, `proxy.ts`; `/` goes to the only workspace or the chooser `/workspaces` |
| Workspaces | `lib/workspace/db.ts` (`withWorkspace`, `db()`, query extension), `lib/api-auth.ts` (`requireWorkspace`, `workspaceRoute`), `lib/server/workspaces.ts`, `app/api/workspaces/`, `app/workspaces/`; plan in `docs/archive/plans-2026-10/workspace-isolation.md` |
| Work queue | `app/w/[workspaceId]/queue/page.tsx`, `QueuePageClient.tsx`, `components/queue/`, `lib/queue-url.ts` (view in the URL); filtering, sorting, pagination, selection, bulk labels, assignments, double annotation (`DoubleAnnotationPanel`, `DoubleBadge`, `double` filter) |
| Individual labeling | `app/w/[workspaceId]/queue/[sentenceId]/page.tsx`, `components/labeling/` (screen, data hooks, panels, comments dialog), `components/TaxonomyBrowser.tsx`, `lib/labeling.ts` (submit and navigation rules), `lib/labeling-navigation.ts` (previous/next list); hierarchical selection, suggestions, keyboard navigation, comments, flags |
| Taxonomy browsing | `app/w/[workspaceId]/taxonomies/[key]/page.tsx` |
| Administration | `app/w/[workspaceId]/admin/`: `taxonomy/` (screen parts in `components/taxonomy-admin/`), `sentences/`, `team/` (`components/team/`), `export/`, `ai-jobs/`, `ai/`, `audit/`; `/admin` redirects to `/admin/taxonomy` |
| Progress | `app/w/[workspaceId]/progress/page.tsx`, `components/progress/` (dashboard: sections, filters, chart/table, people), `lib/progress-url.ts` (view in the URL), `lib/server/progress.ts` and `app/api/workspaces/[workspaceId]/progress/{overview,activity,people}` (fixed query count, `lib/reporting-dates.ts` for UTC days/weeks), `LabelingActivity` written by the label saves (`operationId` from `lib/save-operation.ts`) |
| Record APIs | `app/api/sentences/`; queue queries, stats, imports, assignment, bulk labels, individual records/annotations/comments/flags |
| Other data APIs | `app/api/taxonomies/`, `app/api/imports/`, `app/api/users/`, `app/api/export/` |
| AI APIs | `ai-labeling/` starts labeling and learning, `taxonomies/[key]/sync-ai` queues a sync, `ai-jobs/` provides combined history, active jobs, cancellation, `ai-settings/` the workspace connection; `/api/ai-endpoints` approved services (platform); UI in `app/w/[workspaceId]/admin/ai/` and `app/workspaces/AIEndpointsPanel.tsx` |
| Authentication | `lib/auth.ts` (Better Auth server), `lib/auth-client.ts` (browser), `lib/api-auth.ts`, `lib/passwords.ts`, `proxy.ts`, `app/api/auth/` |
| Database | `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/`, shared client in `lib/prisma.ts` |
| Shared presentation | `styles/globals.css`, `components/`, `lib/utils.ts`, assets in `public/` |
| Operations | `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/`, `scripts/` (`start.sh` is the Compose start command: migrations, optional least-privilege DB role via `db-runtime-role.ts`, `init-admin.ts`, optional demo workspace via `seed-demo.ts` (`DEMO_SEED`, fixtures in `scripts/demo/`), server; `reset-admin-password.ts` for admin recovery; `restore-drill.sh` + `restore-check.ts` for backups; `promote-main.mjs`); logs `lib/logger.ts`, request IDs `lib/request-id.ts` (set in `proxy.ts`), traces `lib/telemetry.ts` (loaded by `instrumentation.ts` only with an OTLP endpoint) |

## Domain model and behavior to preserve

Read `prisma/schema.prisma` before changing data behavior.

- **Workspaces** isolate everything but accounts. Every workspace table has a
  non-null `workspaceId` and composite `(workspaceId, id)` foreign keys; row
  security limits the runtime role to the workspace of the current
  transaction. Pages live under `/w/[workspaceId]`, data APIs under
  `/api/workspaces/[workspaceId]`; client code builds both with
  `lib/workspace/urls.ts`. Workspace data is only accessed inside
  `withWorkspace()` through `db()` (never the `prisma` singleton); use
  `afterCommit()` for work that must see committed rows (AI job launch), and
  `transaction: false` routes with short `withWorkspace()` calls around
  external HTTP or streaming. Roles and the supervisor tree are per
  `WorkspaceMembership`; `User.role` is the platform role (`admin | user`).

- **Sentence** means an imported record, not necessarily a grammatical sentence.
  `SentenceImport` groups a CSV upload; `importOrder` preserves row order.
  Records have up to five `fieldN` values to classify and five `supportN` context
  values. JSON `fieldMapping` / `supportMapping` retain original column names.
- **Taxonomy** has a `key` unique within its workspace, a database `id`, custom
  level names, and a maximum depth of five. Each workspace may have three
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
  Both save endpoints validate leaf/unknown paths and share the completion
  rules. Bulk flags, comments and skips are transactional for the whole
  selection; inspect both save paths when changing completion behavior.
  `escalated` also exists in the schema; flags are a separate boolean.
- `SentenceAssignment` joins records and users. Roles are `admin`, `supervisor`,
  and `labeller`; users can have a supervisor and subordinate labellers. Queue,
  detail, stats, and progress queries apply role/team scoping in their handlers.
  Keep those views consistent when changing visibility or assignment rules.
- **Labeling activity** (`LabelingActivity`, `lib/labeling-activity.ts`) is the
  append-only history the progress reports count: one row per record per
  successful human label save, written in the single and bulk save
  transactions (optional `operationId` dedups replays). Write it from any new
  path that saves human labels; never from AI suggestions or flag/comment saves.
- **Double annotation** (`lib/double-annotation.ts` rules,
  `lib/server/double-annotation.ts` workflow, `lib/server/double-queue.ts`
  queue badges; plan and v1 contract in `docs/plans/double-annotation.md`
  section 0): a `DoubleRound` per record (one active) with two `DoubleTask`s
  (two different people), their immutable `DoubleTaskLabel` answers and a
  `DoubleOutcome` per required taxonomy. `SentenceAnnotation` stays the
  current, exportable result (the first answer while waiting or disagreeing);
  `Sentence.status` is `submitted` only when every required taxonomy is
  agreed, reviewed or accepted. The single save route sends a labeller's save
  to their task and a manager's save on a disagreement to review; bulk label
  and skip refuse active rounds. Labellers of a round see it blind (own
  answer and comments, no AI) in the record, comments and queue reads; keep
  that when adding a read path. `LabelingActivity.kind` separates labelling
  from review decisions (progress counts labelling).
- Comments have resolution state; last-editor and labeling timestamps feed UI
  and progress reporting. Annotation writes also update the taxonomy's
  `newAnnotationsSinceLastLearning` counter.
- `AuditLog` exists in the schema; do not assume every mutation writes one.

The queue and labeling screen show unresolved comment counts, with resolved
counts shown separately. Record links use `/w/[workspaceId]/queue/[sentenceId]`;
`?comments=open` opens the discussion (nuqs). Copy links never include the
browser-local `list` navigation key. Discussion content opens in a `Modal`
(`components/labeling/CommentsDialog.tsx`) at every screen size.

### CSV boundaries

- Record import accepts an optional `id`, one to five `field_*` columns, and up
  to five `support_*` columns. `app/api/sentences/import/route.ts` supports a dry
  run; the admin UI validates before committing.
- Taxonomy CSV uses `id`, `label`, `parent_id`, `level`, plus optional
  `definition`, `examples`, and `synonyms`. Every handler (validate, create,
  replace via PUT, incremental `/[key]/import`) uses `lib/taxonomy-csv.ts`;
  change the rules there. Replacing nodes that labels still use needs
  `confirmOrphans=true`.
- Export includes original field/support names, human labels as
  `{taxonomyKey}_{level}`, and AI codes/confidences as `{taxonomyKey}_ai{level}`
  and `{taxonomyKey}_ai{level}c`, then `annotation_mode`, `annotation_status`
  and `{taxonomyKey}_annotation_status`; `labels=confirmed` and
  `format=details` (each double-annotation answer) are options. All cells go through `lib/csv.ts` (escaping,
  formula neutralising for free text only). Record import does not accept all export columns;
  a full export is not directly round-trippable through that importer.

## Authentication and authorization

Better Auth (`lib/auth.ts`) signs users in with a username or email and a
password and keeps **database sessions** (`Session` rows). Passwords are hashed
by Better Auth and stored on the user's `credential` `Account` row; set or check
them only through `lib/passwords.ts`, and sign users out with
`revokeSessions()`. Public sign-up and Better Auth's account-changing endpoints
are disabled (`disabledPaths`); users are created and changed through
`app/api/users` and the workspace member API (`/api/workspaces/[id]/users`). The `admin` plugin provides ban/unban and session listing for
admins; the roles themselves stay our `Role` enum. Usernames and emails are
stored in lower case.

`proxy.ts` checks the session for page requests (sign-in redirect, initial
password reset) and sets the nonce-based Content-Security-Policy. **It passes
API requests through** apart from a cross-site check. API handlers must perform
their own session and role checks: start every handler with `requireSession()`
from `lib/api-auth.ts` (identity only), `requirePlatformAdmin()`, or — for
everything under `/api/workspaces/[workspaceId]` — `workspaceRoute(roles, ...)`
/ `requireWorkspace(workspaceId, ...roles)` (404 for inaccessible workspaces,
403 for a forbidden role); a route with further segments names them,
`workspaceRoute<'sentenceId'>(...)`. The session and its user are read from the database on every call,
so use the returned `user`. Server pages use `requirePageUser(workspaceId, ...roles)` from
`lib/server/page-user.ts`. Do not infer protection from an `/admin` UI, the
proxy, or a neighboring endpoint.

**Mail and account links** (optional; ENV_SETUP.md "Email"): `lib/mail/`
(`config.ts` with the single `mailEnabled()` gate, the n8n webhook transport,
escaped layout and templates, `outbox.ts`). Queue mail with `queueMail()` in
the transaction of the change that causes it and send it with `deliverSoon()`
(after the response and the commit, `lib/after-response.ts`); `OutgoingMail`
holds metadata only, and links are minted at send time. Generated temporary
passwords go through `queueCredentialMail()` / `sendCredentialMailSoon()`:
memory only, never stored or retried. Password links (`lib/account-links.ts`,
`lib/server/accounts.ts`), workspace invitations (`lib/server/invitations.ts`)
and the CSV member import (`lib/member-import.ts`, `lib/server/member-import.ts`)
build on it; their public pages are listed in `proxy.ts` (`PUBLIC_PAGES`).
Platform events that must commit with their change use `auditInTransaction()`.

Record-level scoping lives in `lib/access.ts`, inside a workspace (admin: all of
the workspace; supervisor: whole team subtree; labeller: own assignments). Any handler that reads or writes a
record uses `sentenceVisibilityFilter()` or `denyUnlessSentencesVisible()`;
writes need the same scope as reads. The access matrix is in
[docs/security.md](docs/security.md); add an integration test when you change it.

## Optional AI integration

- **Per-workspace connections** (`lib/ai-connections.ts`): platform admins
  approve Taxomind endpoints (`AIEndpoint`), for every workspace or only for
  granted ones (`AIEndpointGrant`); a workspace admin creates an
  immutable `AIConnectionVersion` (approved endpoint, namespace
  `<AI_SOURCE_SLUG>--<workspaceId>`, credential encrypted by
  `lib/ai-credentials.ts` with `AI_CREDENTIALS_KEYS`) and turns
  `Workspace.aiEnabled` on. New jobs need `connectionForNewJobs()`; every job
  records its version and keeps it. Never return, log or audit a credential.
  `AI_LABELING_API_URL` only pre-approves an endpoint; there is no
  deployment-wide token.
- `lib/ai-labeling.ts` is the HTTP boundary: `taxomindClient(connection)` with
  bearer token, timeouts, no redirects, job creation/status/cancellation, all
  typed by the OpenAPI contract (`lib/contracts/taxomind.ts`, including
  `TaxonomyRequest`). `lib/ai-utils.ts` builds named field payloads from
  `fieldN` / `fieldMapping`. Batch sizes, thresholds, ceilings and polling
  settings live in `lib/constants.ts`; Compose defaults can differ. Workspaces
  may override the batch sizes and learning threshold (`Workspace.ai*`, read
  with `workspaceJobSettings()`). Jobs store the creating request's ID
  (`requestId`) and send it to Taxomind as `x-request-id`.
- Three job kinds in `lib/ai-job-monitor.ts`: labeling (`AILabelingJob`, its
  records in `AILabelingJobInput`), learning (`AILearningJob` /
  `AILearningJobInput`) and taxonomy sync (`AITaxonomySyncJob`). Routes create
  them `pending` and call `scheduleAIJobs()` after commit; the database
  function `app_admit_ai_jobs()` admits them to `processing` under
  `AI_MAX_ACTIVE_JOBS_PER_WORKSPACE` / `AI_MAX_ACTIVE_JOBS`, fairly across
  workspaces. Results are stored only for the job's input rows. Learning uses
  submitted user annotations and a minimum-new-labels threshold. A taxonomy's
  AI state (`lastAISyncStatus` in API responses) is its latest sync job.
- Ownership is a database lease per job (`leaseOwner`, `leaseExpiresAt`),
  claimed with a conditional update before a job is started or polled and
  renewed on every poll, so only one instance works on a job. Recovery
  (`startJobRecovery()` from `instrumentation.ts`, every 30 s, and
  `ensureJobsMonitored()` from the active-jobs API) takes over admitted jobs
  whose lease expired: it resumes polling when `externalJobId` is set,
  otherwise starts the job. SIGTERM/SIGINT give this instance's leases back
  (`releaseAllLeases()`). Failed status requests back off exponentially
  (capped at 5 minutes). Cancelling (route or workspace archival) asks
  Taxomind to cancel after commit, through the job's own connection.
  `tests/integration/ai-job-monitor.test.ts` runs the monitor against a stub
  service that checks the OpenAPI contract; `ai-connections.test.ts` covers
  connections, admission and lease release.

## Local development and checks

Use Node.js 24 LTS (`.nvmrc`) and npm 11+. `package-lock.json` is committed and
CI and the Dockerfile install it with `npm ci`; `.npmrc` saves exact versions.
Change dependencies with `npm install <pkg>@<version>` and commit the manifest and
lockfile together. Do not introduce a different package manager.

1. `npm ci` (postinstall generates the Prisma client).
2. Copy `.env.example` to `.env` if no local environment exists; configure
   `DATABASE_URL`, auth URL/secret settings, and default-admin settings. See
   `DEVELOPMENT.md` and `ENV_SETUP.md`. Leave AI unconfigured for human-only work.
3. `npm run db:up` starts the development PostgreSQL 18 container on host port
   **5434**. Point the host app's database URL there, as shown in `DEVELOPMENT.md`.
4. `npm run db:migrate` applies committed migrations; `npm run db:init-admin`
   (loads `.env` if present) creates a missing admin and leaves existing
   accounts/passwords unchanged. The scripts are TypeScript run directly by
   Node (`node scripts/x.ts`, type stripping), so they use relative imports with
   `.ts` extensions, not `@/`; plain `node` does not load `.env`.
5. `npm run dev` starts Next.js at `http://localhost:3000`.

| Check | Command / scope |
| --- | --- |
| TypeScript | `npm run typecheck` (TypeScript 7 native compiler, `--noEmit`) |
| Lint | `npm run lint` |
| Format | `npm run format` (Prettier; CI runs `npm run format:check`) |
| Unit tests | `npm test`; Vitest config in `vitest.config.ts`, colocated `*.test.ts` / `*.test.tsx`, Node environment |
| Integration tests | `TEST_DATABASE_URL=.../classiflow_test npm run test:integration`; route handlers against PostgreSQL, see `tests/integration/README.md` |
| Benchmarks | `npm run bench:progress` on a database seeded by `scripts/bench/seed-progress.ts` (DEVELOPMENT.md "Benchmarks") |
| Browser journeys | `npm run build`, then `E2E_DATABASE_URL=.../classiflow_e2e_test npm run test:e2e` (Playwright, with axe-core accessibility checks; see `tests/e2e/README.md`) |
| Production build | `npm run build` (Prisma generation + Next build) |
| New schema migration | Edit schema, then `npx prisma migrate dev --name <change>` against a development database and `npx prisma generate`; commit generated SQL. The history starts at one baseline (`20261021120000_init`, fresh start) |

`next build` type-checks but does not lint (Next.js 16); lint runs in CI. The
React Compiler lint rules are errors (see `eslint.config.mjs`).
Run the checks relevant to a code change and distinguish pre-existing failures
from regressions.

Production uses Next's standalone output in a Node 24 Alpine image (pinned by
digest) with production dependencies only. The Compose
startup command (`scripts/start.sh`) applies migrations as the schema owner,
optionally switches to a least-privilege runtime role, initializes the admin,
then runs `server.js`;
the Dockerfile alone only starts `server.js`. Production Compose leaves app/DB
ports internal for reverse-proxy hosting. `/api/health` checks database
connectivity. See `DEPLOYMENT.md`, `COOLIFY_DEPLOYMENT.md`, and the actual workflow
files for deployment details; these are separate from the local dev stack.

## Working conventions

- Inspect `git status` before editing. Multiple agents may share this checkout;
  preserve unrelated changes and keep edits scoped to the requested task.
- Commit only the files you changed (`git add <paths>`, never `git add -A`).
- Work lands on `staging`, which is meant to deploy to staging on push (currently
  nothing deploys from it; see the handoff). Never push or merge
  into `main`: production is released only with `node scripts/promote-main.mjs`
  after CI is green on `staging` (a ruleset enforces this). See "Deploy
  triggers" in `COOLIFY_DEPLOYMENT.md`.
- Server code logs through `lib/logger.ts` (pino, JSON): `logError(message,
  error, fields)` in route handlers' catch blocks (it adds the request ID), or
  `logger`/`requestLogger()`; not `console.*`. Scripts in `scripts/` and client
  components keep `console`. Never log record text, passwords, tokens or mail
  bodies. `workspaceRoute` already logs unhandled errors and answers 500.
- Use the `@/` root import alias and existing component/route conventions. Keep
  Prisma, auth internals, and AI credentials on the server; interactive React
  files use `'use client'`. App Router dynamic route `params` are promises.
- Workspace data goes through `withWorkspace()`/`db()`; the `prisma` singleton
  from `lib/prisma.ts` is for control-plane data only (accounts, workspaces,
  memberships, invitations, the mail outbox, approved AI services) and narrow
  database functions. ESLint enforces this (`no-restricted-imports` in
  `eslint.config.mjs`, with the allowed files listed there). Keep related
  label/comment/status writes transactional where they already are.
- Tailwind v4 configuration is CSS-based in `styles/globals.css`. Its `indigo`
  palette is deliberately remapped to teal; preserve the established theme.
- UI and route response types are often defined locally, and response envelopes
  vary (`ok`, `success`, or bare data). Update callers alongside handler changes;
  do not assume a universal response format.
- Do not edit generated `.next/`, Prisma client output, or `node_modules/`.
  Inspect maintenance scripts before running them: many update real database
  records or credentials. Keep secrets and generated/imported datasets out of
  commits.
- Documentation map (one topic, one place): README (product, quick start),
  ENV_SETUP (every variable), DEVELOPMENT (local setup), DEPLOYMENT (production
  operations), COOLIFY_DEPLOYMENT (Coolify, deploy triggers, releases),
  docs/security.md (access matrix). Change a topic in its home and link to it.
- Keep this guide aligned with architecture/workflow changes. For a focused
  task, read the relevant code and linked docs rather than treating this overview
  as a complete specification.

What is still open (staging, maintainer decisions, Taxomind) is in
[open items](docs/plans/open-items.md). The October 2026 plans (modernization,
workspace isolation, user management, progress dashboard) are implemented and
archived in `docs/archive/plans-2026-10/`, the hardening review, briefs and
handoff in `docs/archive/hardening-2026-10/`; read them only for the reasoning
behind a decision. These are
dated findings and proposed work, not implemented behavior or additional
standing instructions.
