# Modernization plan (October 2026)

**Status:** decided 21 October 2026; phases 1 and 2 implemented the same day
(see "Implementation status" below). **Baseline:** `staging` at `58bb4c2`.

## Implementation status (21 October 2026)

Done, verified with typecheck, lint (0 errors), 42 unit tests, 57 integration
tests (PostgreSQL 16 locally; CI uses 18), 10 browser journeys against a
production build, and `npm audit --omit=dev` (0 findings):

- **M01** Next 16.4 (`proxy.ts`, Turbopack), React Compiler, ESLint 10 flat
  config, CSP enforced with per-request nonces. The page guard reads the
  database session. The React Compiler lint rules found 18 effect/ref patterns in
  the queue, labelling and taxonomy browser components; they are warnings until
  M06 splits those components.
- **M02** Prisma 7.10 with `@prisma/adapter-pg`, client in `lib/generated/prisma`,
  `prisma.config.ts`, explicit pool size (`DATABASE_POOL_SIZE`), scripts in
  TypeScript (`node scripts/*.ts`), no `openssl` or engine install scripts. The
  "restored copy of a populated database" test is moot (fresh start).
- **M03** (partly) Vitest 5, Playwright 1.64, TypeScript 6.0 for the build and
  the native 7.0 compiler for `npm run typecheck` (same results, about twice as
  fast), lucide-react 1.x, unused dependencies removed, build-only packages in
  `devDependencies`, Dependabot groups, Actions pinned to commit SHAs.
- **M04** Better Auth 1.7: database sessions, username and admin plugins,
  database rate limit, `mustResetPassword` as an additional field;
  `requireSession()` signatures unchanged. The integration suites pass; the only
  test changes are the harness (`setup.ts`, `helpers.ts`: real `Session` rows)
  and fields that no longer exist.
- **M05** Server pages read through `lib/server/*`; queue list and stats share
  one filter parser (`queueWhere`); `lib/contracts/progress.ts`; error state
  instead of empty data; `lib/server-fetch.ts` deleted.
- **M00** PostgreSQL 18 everywhere, one baseline migration, external-training
  model and the `isLeaf` / `'success'` fallbacks removed, label-integrity report
  deleted, upgrade path dropped from the docs.
- **M08** Trivy scan of the smoke image in CI. Done 22 October 2026: pino
  JSON logs with redaction (`lib/logger.ts`), a request ID per request
  (`lib/request-id.ts`, set in `proxy.ts`, returned as `x-request-id`, stored
  on audit entries as `AuditLog.requestId`), unhandled workspace-route errors
  logged and answered with a plain 500, OpenTelemetry traces over OTLP/HTTP
  when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`lib/telemetry.ts`, loaded by
  `instrumentation.ts` only then; checked against the standalone build with a
  local collector), trace IDs on log lines, read-only root filesystem in
  Compose. Server `console.*` calls were replaced in shared infrastructure and
  the record, import, comment, assignment and export routes; the AI, users,
  auth, taxonomy and progress code still uses `console` (owned by parallel
  work at the time). Not done: passing the request ID to Taxomind (the AI
  client was being reworked), alerts (need a log/trace backend), memory/CPU
  limits (need production numbers).
- **M09** Taxomind contract: types generated from Taxomind's OpenAPI document,
  calls through `openapi-fetch`, every response parsed in
  `lib/contracts/taxomind.ts`; the stub service checks requests and replies
  against the document. Verified with typecheck, lint (0 errors), 48 unit
  tests, 77 integration tests (PostgreSQL 16) and a production build. W07's
  idempotent start stays open (Taxomind does not deduplicate); see M09.

Still open from this plan:

- ~~M03 formatter and `noUncheckedIndexedAccess`~~ done 21 October 2026:
  Prettier (`npm run format`, checked in CI; the reformat commit is in
  `.git-blame-ignore-revs`) and `noUncheckedIndexedAccess` on. Workspace route
  handlers name their segments (`workspaceRoute<'sentenceId'>(...)`), so
  route parameters are typed instead of an index signature.
- M01: remove hand-written `useMemo`/`useCallback` where the compiler covers
  them (optional).
- ~~M07~~ done 22 October 2026 with the progress backend
  ([progress dashboard](progress-dashboard.md), "Implementation status"):
  `pg_trgm` indexes for the queue search (through `app_search_sentences()`,
  because row security keeps them from the runtime role's ILIKE) and one
  grouped query for the team metrics instead of ~8 per member.
- **M06 part 1** done 22 October 2026 (lane C1): TanStack Query
  (`components/QueryProvider.tsx` per workspace/user/role, `lib/query/` keys and
  fetch), nuqs for the queue view (`lib/queue-url.ts`, shared with the server
  page), Radix `Combobox` (popover) for the queue filter pickers and Radix
  `DropdownMenu` for the user menu, a searchable assignment dialog, the
  labelling page split into `components/labeling/` (data hooks, record panel,
  action bar, comments dialog) with its rules in `lib/labeling.ts` (unit
  tested), `TaxonomyBrowser` deriving its level from the labels instead of
  syncing in effects (Up now goes one level up; it used to jump to the top
  from the third level), the React Compiler warnings in those files fixed
  (lint warnings 25 → 7), and `@axe-core/playwright` on the main pages
  (`tests/e2e/accessibility.spec.ts`; contrast and naming fixes in the queue,
  labelling and sidebar). Conventions are in AGENTS.md "Frontend conventions".
  Behaviour changes: the queue list no longer replaces the table with a
  spinner on every change (old rows stay, dimmed, until the new ones arrive);
  saving a comment keeps the dialog open with the comment listed.
- **M06 part 2** done 22 October 2026 (lane C2), so **M06 is done**: the
  taxonomy admin screen split into `components/taxonomy-admin/` (data hook
  with `refetchInterval` while a sync or learning job runs, card, create /
  edit / delete dialogs, file chooser; pure helpers in `lib/taxonomy-admin.ts`,
  unit tested); the AI jobs page, the AI job badge and AI settings on
  TanStack Query (no hand-written intervals or abort code left;
  `lib/latest-request.ts` deleted); the audit log on `useInfiniteQuery` with
  its filters in the URL through nuqs; the Team page's search, filters and
  sort in the URL (`lib/team-url.ts`, unit tested); the team supervisor
  pickers (filter, add member, member drawer) on `Combobox`; `/accounts` on
  Query with its own cache. The React Compiler rules are errors again
  (`eslint.config.mjs`); no warnings remain in client code. axe-core now also
  covers taxonomy admin and its create dialog, AI jobs, AI settings, records
  admin, export, the add-member dialog, accounts, forgot-password and
  set-password, with no accepted exceptions (`tests/e2e/a11y.ts` `KNOWN` is
  empty; the contrast and naming fixes are in those screens, the sign-in and
  password pages' buttons included). After a bulk label or skip the queue
  clears its selection (the records left the view). Not done: TanStack Table
  for the team list (optional; the hand-made table is small and tested), and
  M01's optional removal of hand-written `useMemo`/`useCallback`.
- The rest of M08 (above), the open points under M09, and the "Carried over
  from hardening" list.
- Watch: Prisma 7.10's query interpreter runs the sub-queries of one
  operation (relation `include`s) in parallel on an interactive
  transaction's connection, which `pg` 8 reports as a deprecation
  ("client.query() when the client is already executing a query") and `pg` 9
  will reject. Our own queries inside a workspace transaction are already
  queued (`lib/workspace/db.ts`). Do not take `pg` 9 before Prisma's adapter
  handles this; Dependabot's Prisma group should bring the fix.
- Setting up staging and production from the docs (phase 3) is the
  maintainer's.

This plan answers one question: which parts of the stack should be upgraded or
replaced before feature work continues? It picks up where the hardening round
stopped ([handoff](../archive/hardening-2026-10/hardening-handoff.md), [review](../archive/hardening-2026-10/2026-10-21-review.md),
[briefs](../archive/hardening-2026-10/hardening-workstreams.md), all archived). That round already moved to
Node 24, a committed lockfile with `npm ci`, Dependabot, a pinned base image,
Playwright journeys, database leases for AI jobs and a streamed export. This
plan does not repeat those. Where an item closes an open hardening line, it
names the W-number. Items are M00–M09. Open hardening items that fit none of
them are listed under "Carried over from hardening"; the archived docs are
history, not a to-do list.

It also has to fit the [user management plan](user-management.md) (U1–U6):
M04 changes how sessions, deactivation and login throttling work, so build
M04 before U3 and U5 (see "Order").

## Decisions (21 October 2026)

- **Fresh start.** No staging or production deployment exists, and no
  database holds data that must be kept. Both environments will be set up
  again from these docs. Schema changes therefore need no data migration
  until real data goes into production (see M00).
- **Auth: move to Better Auth** (M04).
- **Coolify keeps building from git.** No image registry; the lockfile, the
  digest-pinned base image and the release check in `/api/health` are what
  tie a deployment to the tested commit (M08).
- **TanStack Query: adopt it** for the screens that refresh themselves (M06).
- **PostgreSQL 18 from the start** instead of a later upgrade (M00).

## Baseline measured on `58bb4c2`

`npm ci` on Node 22.22 (CI and Docker use 24):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passes |
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` | 45 tests in 11 files pass |
| Integration and e2e suites | Exist and run in CI; not run here (need PostgreSQL / a build) |
| `npm audit --omit=dev` | 6 entries: 0 critical, 5 high, 1 moderate |

The remaining runtime findings are the ones W03 accepted as build/CLI-only:
`postcss` inside `next` (fixed only in Next 16.4.2) and `prisma` /
`@prisma/config` / `effect` / `deepmerge-ts` (fixed only in Prisma 7.10.1).
M01 and M02 clear them.

Installed versions against the latest stable releases on 21 October 2026
(npm registry):

| Area | Installed | Latest stable | Target |
| --- | --- | --- | --- |
| Node.js | 24 (CI, Docker, `engines`) | 24 LTS; 26 becomes LTS end of October | keep 24; move to 26 in 2027 with a Dependabot base-image PR |
| Next.js | 15.5.28 | 16.4.2 | **16.4** (M01) |
| React | 19.3.1 | 19.3.1 | keep; add React Compiler 1.0 (M01) |
| Auth | next-auth 5.0.0-beta.32 | Auth.js is in security-only maintenance; Better Auth 1.7.12 | **Better Auth** (M04) |
| Prisma | 6.17.1 | 7.10.1 (8.0 is a release candidate) | **7.10** (M02); not 8 until GA |
| PostgreSQL | 16 | 18 | **18** (M00) |
| TypeScript | 5.9.3 | 7.0.2 (native compiler) | 6.0 for the build, trial 7 for `typecheck` (M03) |
| ESLint | 9.39 via `FlatCompat` | 10.13; `eslint-config-next@16` ships a flat config | **10**, drop `@eslint/eslintrc` (M01) |
| Vitest | 4.1.12 | 5.0.5 | **5** (M03) |
| Playwright | 1.56.1 | 1.64.1 | **1.64** (M03) |
| Tailwind CSS | 4.3.3 (range `^4.1.14`) | 4.3.3 | keep; raise the declared range |
| lucide-react | 0.546 | 1.61 | **1.x** (M03; icon renames) |

## Answers to the big questions

**Framework: stay on Next.js, upgrade to 16.** classiflow is a signed-in
internal tool with no SEO needs, so a Vite single-page app with a separate API
(Hono), React Router or TanStack Start would also fit. Moving would rewrite
routing, the auth glue, 36 route handlers, the e2e harness and the deployment,
for no user-visible gain. What should change is how the app *uses* Next:
server pages fetch their own API over HTTP (M05), and the page guard trusts
the JWT while the API checks the database (M01).

**ORM: stay on Prisma, upgrade to 7.** Prisma 7 drops the Rust query engine
(smaller image, no engine install scripts) and runs on the `pg` driver. Drizzle
would mean rewriting every query, including the locking and lease SQL the
hardening round tested, with no correctness benefit.

**Auth: move to Better Auth (decided).** next-auth v5 never
had a stable release. Since September 2025 Auth.js has been maintained by the
Better Auth team for security fixes only, and they recommend Better Auth for
new work. classiflow now rebuilds a session system on top of JWTs:
`sessionVersion`, a database read on every API call, an in-process login
throttle. Better Auth ships database sessions, session revocation, user bans
and a database-backed rate limiter, all of which the user management plan
needs. Details are in M04.

**Background jobs: keep the W07 design.** AI jobs now have database leases,
recovery at server start and poll backoff, and they work across instances.
A queue library (pg-boss, graphile-worker) or a separate worker container is
not needed at this scale. Revisit only if jobs multiply (scheduled exports,
email, nightly learning) or the web process must stay free of polling.

**Infrastructure: PostgreSQL covers it.** Job state, rate limits (M04) and
text search (M07) all fit in the existing database. No Redis, no broker, no
extra service.

## Workstreams

Effort: S focused change, M several files/areas, L cross-cutting or migration.

### M00 Fresh-start cleanup (P1, M; before real data goes into production)

Code and migrations that exist only to carry old databases forward can go,
because there are none. Do this after M02 and M04, since both change the
schema, and before the first production deployment holds real data. A
staging environment can run earlier: its data is disposable.

- **PostgreSQL 18 everywhere:** both Compose files, the CI service containers,
  `scripts/restore-drill.sh`, and the "tested version" note in DEPLOYMENT.md.
  The official 18 image keeps its data under `/var/lib/postgresql/18/docker`;
  mount `/var/lib/postgresql` as its docs describe.
- **One baseline migration:** replace the 16 migrations with a single `init`
  migration generated from the final schema (after M02 and M04). This also
  drops the `classiflow_backup` duplicate-copy step of the unique-label
  migration, which has nothing to copy on an empty database. Keep the
  runtime-role and lease SQL that the integration tests check.
- **Remove legacy-only code:**
  - `AIExternalTrainingJob`: kept only to show historical jobs; there are
    none. Remove the model, its relations on `User`/`Taxonomy` and its reads
    in the AI job list, active jobs, cancel, user and taxonomy routes.
  - `TaxonomyNode.isLeaf` becomes required (imports always set it); remove
    the null fallbacks in `app/api/taxonomies/[key]/nodes/route.ts` and
    `lib/label-path.ts`.
  - The `'success'` sync status kept "for backward compatibility" in
    `app/queue/QueuePageClient.tsx`, if nothing writes it any more.
  - `scripts/label-integrity-report.sql` checks labels saved before
    validation existed; with no such data, delete it (or keep it as a
    sanity check, but drop the backup-table section).
- **Docs:** drop the "Upgrading an existing Compose deployment" path
  (old fallback DB password) from DEPLOYMENT.md, and keep one clean
  first-time setup for staging and production. Setting up the two new
  environments from DEPLOYMENT.md / COOLIFY_DEPLOYMENT.md is the test of
  those docs; fix whatever does not match.

### M01 Next.js 16 (P1, M; closes the `postcss` finding, part of W03 and W04)

- Run `npx @next/codemod upgrade latest`, then review by hand. Commit the
  upgrade alone, before any of the changes below.
- **`middleware.ts` → `proxy.ts`** (function renamed `proxy`, Node runtime).
  On Node the page guard can use the same database check as
  `requireSession()` (role, reset flag, session version), so a revoked or
  demoted user is turned away by pages as quickly as by the API. Today it
  tests `if (!session)`, the existence check the beta.31 advisory warned
  about; test `session?.user?.id` at least.
- **CSP with nonces** (W04 open item): generate a nonce per request in
  `proxy.ts`, drop `'unsafe-inline'` from `script-src`, give the sidebar init
  script in `app/layout.tsx` the nonce, then enforce the header. The e2e
  journeys already fail on any CSP report, so they are the test.
- Remove the `eslint` block from `next.config.ts` (`next lint` is gone in 16;
  CI runs `eslint .`). Turbopack becomes the build default; there is no custom
  webpack config. Keep `output: 'standalone'`; the CI smoke job checks the
  image, health and release.
- **ESLint 10** with `eslint-config-next@16`'s native flat config; remove
  `FlatCompat` and `@eslint/eslintrc`.
- **React Compiler** (`reactCompiler: true`, `babel-plugin-react-compiler`)
  in its own commit after the upgrade is green, so it can be reverted alone.
  Remove hand-written `useMemo`/`useCallback` only where the compiler covers
  them and the e2e journeys still pass.
- Not now: Cache Components / `use cache`. Nearly all data is per user and
  role-scoped (`no-store`). Revisit for taxonomy metadata only.

### M02 Prisma 7 (P1, M; closes the Prisma findings in W03)

- Generator `provider = "prisma-client"` with an explicit `output` (for
  example `lib/generated/prisma`, git-ignored), `prisma.config.ts` for the
  datasource URL and migrations, `@prisma/adapter-pg` in `lib/prisma.ts`.
- Set the `pg` pool size explicitly; the adapter's defaults differ from
  Prisma 6. Write the per-instance connection budget into DEPLOYMENT.md next
  to the multi-instance notes.
- The three plain-Node scripts (`init-admin.js`, `reset-admin-password.js`,
  `db-runtime-role.js`) `require('@prisma/client')`. With a generated client
  they must import it from the output path. Convert them to TypeScript run
  with Node 24's built-in type stripping (`node scripts/init-admin.ts`) so they
  share types with the app; keep them runnable inside the image.
- Docker: the `prod-deps` stage still needs the Prisma CLI for
  `migrate deploy` in `scripts/start.sh`. Remove `@prisma/engines` from
  `allowScripts` if nothing installs an engine any more; check whether
  `openssl`/`libc6-compat` are still needed.
- Prisma 7 does not load `.env` by itself; `prisma.config.ts` must, and the
  `db:*` scripts must keep working.
- Test: all migrations on an empty database (CI smoke) **and** on a restored
  copy of a populated database (the W12 upgrade test; `scripts/restore-drill.sh`
  gives the procedure), then the integration suite, including the lease,
  locking and runtime-role tests.

### M03 Tooling (P2, S each)

- **Vitest 5**, **Playwright 1.64** (keep the CI `npx playwright install`
  step in sync with the package version).
- **TypeScript:** 6.0 with the framework upgrade. Then try TS 7's native
  compiler for `npm run typecheck` only (much faster) and keep it if the
  results match. Add `noUncheckedIndexedAccess` and fix what it finds.
- **Formatter:** the code mixes tabs and two-space indentation. Adopt one
  formatter (Biome in format-only mode, or Prettier), reformat in a single
  commit listed in `.git-blame-ignore-revs`, check it in CI.
- **Unused dependencies** (no imports found): `@tanstack/react-query`,
  `zustand`, `next-themes`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `autoprefixer`. Remove them, or re-add deliberately in
  M06 (TanStack Query stays: M06 adopts it). Move build-only packages (`@tailwindcss/postcss`, `postcss`,
  `tailwindcss`) to `devDependencies`; check `prisma` stays where
  `prod-deps` can install it.
- **Dependabot:** add groups for the framework (`next`, `react`,
  `eslint-config-next`) and Prisma (CLI, client, adapter), so their majors
  arrive as one PR each instead of mismatched halves.
- **`lucide-react@1`** (renamed icons; one commit, e2e journeys as the check).
- Pin GitHub Actions to commit SHAs (W03 open item; a person or an agent with
  access to the actions' repositories).

### M04 Authentication on Better Auth (P1, L; decided)

**Why:** next-auth v5 is a beta in security-only maintenance. The user
management plan adds deactivation (U3), "sign out everywhere", lockout
records and unlock (U5), and "last seen" (U1). On the current design each of
those is more custom code around `sessionVersion` and an in-process throttle
that does not work across instances. Better Auth has them built in, and also
offers 2FA, passkeys and OIDC/SAML SSO for the open W02 MFA/SSO decision.

**Shape:**

- Database sessions instead of JWTs. Revoking = deleting session rows; this
  replaces `User.sessionVersion` and the JWT callbacks in `lib/auth.ts`.
  `session.updatedAt` can serve U1's "last seen".
- `username` plugin for username-or-email sign-in; `admin` plugin for roles,
  ban/unban (U3 deactivation), list/revoke a user's sessions (U5). Keep our
  three roles and the supervisor tree in our own schema.
- Rate limiting with `storage: "database"` replaces `lib/login-throttle.ts`
  (consistent across instances; U5's lockout badge and unlock read it).
- Use Better Auth's own password hashing. No existing accounts, so no bcrypt
  compatibility layer; `bcryptjs` goes once `init-admin` and
  `reset-admin-password` use Better Auth's API to create and reset users.
- `mustResetPassword` becomes an additional user field, enforced where it is
  today.
- Keep the `requireSession()` / `requireSessionAllowingReset()` signatures in
  `lib/api-auth.ts`, so route handlers do not change. The access-control,
  audit and labelling integration suites must pass unmodified; that is the
  acceptance gate. Update `docs/security.md` ("Sessions") and AGENTS.md.
- Schema: add Better Auth's session/account/verification tables and remove
  `User.passwordHash` and `User.sessionVersion` in the same change. No
  backfill: there are no accounts to carry over (fresh start), and M00 folds
  the result into the baseline migration.
- Update the user management plan where it assumes `sessionVersion` (U3
  deactivation, U5 "sign out everywhere") and the in-process throttle (U5
  lockout badge and unlock) to use the Better Auth equivalents.

### M05 Server data layer instead of self-HTTP (P1, L)

Six server pages (`queue`, `progress`, and four admin pages) load data by
calling this app's own API over HTTP with the user's cookies
(`lib/server-fetch.ts`). That adds a request per page, needed the W04 loopback
hardening, and turns every failure into `null`, so a broken load looks like
empty data.

- Domain modules under `lib/server/` (`import 'server-only'`): `sentences`,
  `progress`, `taxonomies`, `users`, `ai-jobs`, `audit`. Each function takes
  the `CurrentUser` and applies `lib/access.ts` scope itself.
- Route handlers become thin: `requireSession` → parse input with zod →
  call the module → respond. Server pages call the same modules directly and
  show an error state when they fail.
- Move the queue/stats filter parsing into one shared function here (closes
  the W10 "same filter parameters in two places" item).
- Request/response schemas in `lib/contracts/` (zod 4), shared by handlers and
  client components. Response envelopes still vary (`ok`, `success`, bare
  data); converge per touched route and update callers in the same commit.
- Delete `lib/server-fetch.ts` when nothing calls it.
- Not now: tRPC/oRPC. Shared zod contracts give most of the type safety
  without a second API style; reconsider if contracts keep drifting.

One area per commit, starting with progress (read-only) and ending with the
queue. Do it before M06 and before U2, so the Team page is built on it.

### M06 Frontend libraries (P2, M; continues W09)

The hardening round fixed queue races (`lib/latest-request.ts`), dialogs
(`components/Modal.tsx`) and hidden-tab polling by hand. Keep those. Add
libraries only where new work would otherwise hand-roll them again:

- **TanStack Table** (+ Virtual for long lists) for the U2 Team page
  (sorting, filtering, column visibility) and later the queue list.
  Building U2 on it avoids a third hand-made table.
- **nuqs** for URL-synced filters: queue filters, the U2 Team filters and
  U6's "`/admin/audit` reads its filters from the URL". Back button and shared
  links then work everywhere the same way.
- **TanStack Query (decided: adopt).** It is installed but unused, and four
  components refresh themselves with hand-written `setInterval` loops plus
  their own abort and hidden-tab code (AI jobs, taxonomy admin, job badge,
  queue stats). Move those to TanStack Query (`refetchInterval`, which pauses
  in hidden tabs, request cancellation, one cache) when M05 rewrites their
  data loading, and delete the hand-written code. New client screens (U2)
  use it from the start.
- **Headless primitives** (Radix, already used for the tooltip) for the
  widgets not yet built accessibly: combobox (user/taxonomy pickers), menus,
  select. Keep `Modal.tsx`. shadcn/ui is optional: use it as a source of
  component code to copy, not as a wholesale restyle; keep the teal theme.
- Split the 1,000-line labelling page and taxonomy admin client (W09 open
  item) along the seams these create: data hooks, dialogs, panels.
- Open W09 checks (contrast, narrow viewports, keyboard panel resizing):
  add `@axe-core/playwright` to the existing journeys so contrast and naming
  regressions fail CI.

### M07 Search and query tuning (P2, M)

**Done** (22 October 2026); results and the row-security finding are in the
[progress dashboard plan](progress-dashboard.md) "Implementation status".

PostgreSQL 18 itself is part of M00 (no upgrade needed on a fresh start).

- Queue text search uses `contains` with `mode: 'insensitive'` across five
  columns, which cannot use the B-tree index on `field1`. Add `pg_trgm` GIN
  indexes on the searched columns (raw SQL migration), measured with
  `EXPLAIN ANALYZE` on representative data as W08 asks.
- Use Prisma TypedSQL for the team metrics that still query per member (W08
  open item).
- Keep `cuid` IDs.

### M08 Release and observability (P1; closes W12 open items)

- **Coolify builds from git (decided).** The W03 "promote the tested image"
  item is closed as not wanted. What ties a deployment to the tested commit:
  the committed lockfile and digest-pinned base image (same dependency graph
  and OS packages), Coolify's "Include Source Commit in Build", and
  `deploy-prod` waiting until `/api/health` reports the promoted commit
  (set the repository variable `PROD_HEALTH_URL` when production exists).
- **Image scan:** run Trivy on the image the CI `smoke` job already builds,
  failing on fixable critical findings.
- **Structured logs** (W12 open): pino with JSON output and redaction (no
  record contents, passwords or tokens), a request ID set in `proxy.ts` and
  passed to AI calls and audit entries.
- **Traces/metrics:** OpenTelemetry through the existing `instrumentation.ts`
  (Next's built-in support), exported only when an OTLP endpoint is
  configured. Alerts for failed deploys and stuck AI jobs build on these.
- Read-only root filesystem and limits: see "Carried over from hardening".

### M09 Taxomind contract (P2, S; done 21 October 2026)

`lib/ai-labeling.ts` typed Taxomind's requests and responses by hand, and
`lib/ai-results.ts` validated results after the fact. If Taxomind publishes
an OpenAPI document, generate types with `openapi-typescript` and call it via
`openapi-fetch`; otherwise put zod schemas for the boundary in
`lib/contracts/taxomind.ts`. Reuse the stub HTTP service from
`tests/integration/ai-job-monitor.test.ts` as the contract test. W07's
idempotent job start (send `batchId`, let Taxomind deduplicate) belongs here
if Taxomind supports it.

**Done.** Taxomind is a FastAPI service and serves its OpenAPI document at
`/openapi.json`, with a response model on every endpoint classiflow uses.

- `lib/contracts/taxomind.openapi.json` is a snapshot of that document
  (Taxomind `f7a9e91`, FastAPI 0.121.3 / Pydantic 2.12.4 as in its
  `requirements-prod.txt`). `npm run taxomind:types` regenerates
  `taxomind.openapi.ts` from it (`openapi-typescript`; an `overrides` entry lets
  it use TypeScript 6). To refresh: save `$AI_LABELING_API_URL/openapi.json`
  over the snapshot, regenerate, run typecheck and the integration tests.
- `lib/ai-labeling.ts` calls Taxomind through `openapi-fetch`, keeping the
  bearer token, the 3 min / 30 s timeouts and best-effort cancel. Labeling and
  learning requests are typed by the generated `LabelingRequest` /
  `LearningRequest`.
- `lib/contracts/taxomind.ts` parses every response with zod: the job id of
  each creation response (`job_id`, or `jobId` for `/learn`), the status
  (`pending`, `running`, `completed`, `failed`, `canceled`) and the labeling
  result. Each schema is checked against the generated type, so a regenerated
  contract that renames or retypes a field fails typecheck. The old
  `lib/ai-results.ts` lives on here as `parseLabelingResults`. It still takes
  only the job's own records, drops malformed ones and keeps codes as strings.
  It now expects the contract's `sentenceId` and string `nodeCode`.
- Behaviour changes, all from the contract: a malformed status response (not
  JSON, unknown or missing status) counts as a failed status request (backoff,
  then the poll timeout). The aliases `complete`, `success` and `error` are gone
  (Taxomind never sends them). A job Taxomind reports as `canceled` is failed
  with that reason instead of being polled until it times out (monitor and
  taxonomy sync).
- Contract test: the stub in `tests/integration/ai-job-monitor.test.ts` converts
  the document's schemas with `z.fromJSONSchema` and checks every request
  classiflow sends and every reply it gives. It covers labeling, learning,
  taxonomy sync through the `sync-ai` route and cancel, plus malformed replies
  (not JSON, missing or unknown status, start response without a job id,
  refused start, partial and empty results), Taxomind-side cancellation,
  `sourceSlug` (`AI_SOURCE_SLUG--<workspaceId>`), leading zeros and the
  unknown codes.

Still open:

- **W07 idempotent start:** Taxomind requires `batchId` on `/label` but
  creates a new job for every request (`uuid4`) and does not deduplicate.
  If an instance dies after `POST /label` succeeded but before it saved
  `externalJobId`, recovery sends the batch again. Closing this needs
  Taxomind to deduplicate by `(sourceSlug, batchId)` and return the existing
  job. `/learn` has no batch id at all.
- ~~**Taxonomy delete notification**~~ resolved 22 October 2026: the call
  (`action: 'delete'`, always answered 422) is gone, with `aiNotified`.
  Deleting a taxonomy leaves the workspace's model for that key in Taxomind
  until a new sync replaces it. A real delete needs a Taxomind delete action
  first (Taxomind-side work); then add it as a job kind.
- ~~**Typed taxonomy requests**~~ done: the taxonomy sync job sends the
  generated `TaxonomyRequest` (no `description`, no `synonyms`, which Taxomind
  ignores).
- **Taxomind end to end** (below): still only the stub; the snapshot makes
  the stub match Taxomind's declared contract, not its runtime behaviour.

## Carried over from hardening

Open items from the archived hardening briefs that no M-item covers. Items
made moot by the fresh start (production label-integrity report, the
duplicate-label backup table, the old fallback database password) are dropped.

- **Live reverse proxy check** (W04), when staging and production are set up:
  `Host` forwarded, HSTS, 50 MB body limit, rate limit on
  `POST /api/auth/callback/credentials` (DEPLOYMENT.md "Reverse proxy").
- **Taxomind end to end** (W07): run labeling and learning against a real
  Taxomind; so far only the stub service in
  `tests/integration/ai-job-monitor.test.ts` has been used.
- ~~**Release AI job leases on shutdown**~~ (W07) done: SIGTERM/SIGINT run
  `releaseAllLeases()` (`app_release_ai_leases()`), so another instance takes
  over at once; a killed instance's leases still expire within 2 × poll
  interval + 60 s.
- ~~**More browser journeys** (W10)~~ done 22 October 2026 (`tests/e2e/labelling-bulk.spec.ts`, `taxonomy-admin.spec.ts`): taxonomy admin and bulk labelling (team
  management comes with the [user management plan](user-management.md)).
- **Backups** (W12, phase 3): the maintainer sets recovery objectives
  (tolerated data loss, recovery time); then off-host encrypted dumps on a
  schedule, retention, an alert on failure, and `scripts/restore-drill.sh` on
  a real dump (the drill now also runs `scripts/restore-check.ts`: row
  security, runtime role and per-workspace rows).
- **Read-only root filesystem** done 22 October 2026 (DEPLOYMENT.md "Container hardening"); **limits** still open. Original item (W12): check that the Prisma CLI
  writes nothing during `migrate deploy`, then add `read_only` with a `/tmp`
  tmpfs, and memory/CPU limits sized from production usage.
- **Audit log retention** (W12): the maintainer picks a period; pruning is
  SQL (DEPLOYMENT.md "Audit log").
- **Required check** (maintainer): add the `e2e` CI job to the `main`
  ruleset (`deploy-prod` already waits for it).

## Order

| Phase | Items | Notes |
| --- | --- | --- |
| 1 — upgrade train | M01, M02, M03 | One commit per upgrade (Next 16, ESLint 10, Prisma 7, Vitest 5, Playwright, TS 6). CI fully green after each. Clears the accepted audit findings. |
| 2 — foundations | M04, M05, then M00 | Better Auth before U3/U5. M05 before U2 so the Team page uses the data layer. M00 last, once the schema is final. |
| 3 — environments | staging, then production | Set both up from the docs on PostgreSQL 18. Real data only after M00. Then W12: backups, restore drill on a real dump. |
| 4 — features on top | user management U1–U6, M06 | U2 is the first user of TanStack Table, nuqs and TanStack Query. U1 can start in phase 2 if it targets Better Auth's session table. |
| 5 — later | M07, M08 logs/traces, M09 | Tuning needs representative data. |

A staging environment can be set up at any point for trying things out; its
database is disposable until M00 lands.

## Deliberately not doing

- Rewriting on another framework (TanStack Start, React Router, SvelteKit,
  SPA + separate API). See "Answers to the big questions".
- Replacing Prisma with Drizzle or raw SQL.
- A job queue library, Redis, a broker, or a separate worker service.
- Edge runtime anywhere.
- Prisma 8 before general availability.
- Switching package manager (npm with a lockfile is reproducible now).
- An image registry or deploy-by-digest; Coolify builds from git.

## Open points for the maintainer

None. Confirmed 21 October 2026: no database anywhere holds data worth
keeping, so M00 can replace the migration history.

## Sources

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Prisma 7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Auth.js is now part of Better Auth](https://github.com/nextauthjs/next-auth/discussions/13252)
- [Better Auth security update, July 2026](https://better-auth.com/blog/security-update-july-2026)
- Package versions: npm registry, 21 October 2026. Node.js release lines:
  `nodejs.org/dist/index.json`, 21 October 2026.
