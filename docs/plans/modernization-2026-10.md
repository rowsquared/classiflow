# Modernization plan (October 2026)

**Status:** proposed, nothing implemented. **Baseline:** `staging` at `58bb4c2`,
checked 21 October 2026. **Owner:** maintainer to assign.

This plan answers one question: which parts of the stack should be upgraded or
replaced before feature work continues? It picks up where the hardening round
stopped ([handoff](hardening-handoff.md), [review](../reviews/2026-10-21-review.md),
[briefs](../reviews/hardening-workstreams.md)). That round already moved to
Node 24, a committed lockfile with `npm ci`, Dependabot, a pinned base image,
Playwright journeys, database leases for AI jobs and a streamed export. This
plan does not repeat those. Where an item closes an open hardening line, it
names the W-number. Items are M01–M09.

It also has to fit the [user management plan](user-management.md) (U1–U6):
M04 changes how sessions, deactivation and login throttling work, so decide
M04 before U3 and U5 are built (see "Order").

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
| Auth | next-auth 5.0.0-beta.32 | Auth.js is in security-only maintenance; Better Auth 1.7.12 | **Better Auth** (M04, needs a decision) |
| Prisma | 6.17.1 | 7.10.1 (8.0 is a release candidate) | **7.10** (M02); not 8 until GA |
| PostgreSQL | 16 | 18 | **18** (M07) |
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

**Auth: move to Better Auth, if the maintainer agrees.** next-auth v5 never
had a stable release. Since September 2025 Auth.js has been maintained by the
Better Auth team for security fixes only, and they recommend Better Auth for
new work. classiflow now rebuilds a session system on top of JWTs:
`sessionVersion`, a database read on every API call, an in-process login
throttle. Better Auth ships database sessions, session revocation, user bans
and a database-backed rate limiter, all of which the user management plan
needs. Details and the fallback are in M04.

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
  M06. Move build-only packages (`@tailwindcss/postcss`, `postcss`,
  `tailwindcss`) to `devDependencies`; check `prisma` stays where
  `prod-deps` can install it.
- **Dependabot:** add groups for the framework (`next`, `react`,
  `eslint-config-next`) and Prisma (CLI, client, adapter), so their majors
  arrive as one PR each instead of mismatched halves.
- **`lucide-react@1`** (renamed icons; one commit, e2e journeys as the check).
- Pin GitHub Actions to commit SHAs (W03 open item; a person or an agent with
  access to the actions' repositories).

### M04 Authentication on Better Auth (P1, L; decision needed)

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
- Keep existing bcrypt hashes: custom password `verify` accepts bcrypt;
  re-hash on the next successful sign-in. No forced password resets.
- `mustResetPassword` becomes an additional user field, enforced where it is
  today.
- Keep the `requireSession()` / `requireSessionAllowingReset()` signatures in
  `lib/api-auth.ts`, so route handlers do not change. The access-control,
  audit and labelling integration suites must pass unmodified; that is the
  acceptance gate. Update `docs/security.md` ("Sessions") and AGENTS.md.
- Migration: add Better Auth's session/account/verification tables, create a
  credential account per user from `passwordHash`, switch, and drop the old
  columns in a later release. Everyone signs in once after the switch.

**If not approved:** stay on next-auth beta.32, take security patches as
Dependabot offers them, and build U3/U5 on `sessionVersion` as the user
management plan describes. Workable; the maintenance risk and the
per-instance throttle remain.

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
- **TanStack Query: decide once.** It is installed but unused, and four
  components run their own `setInterval` polling. Either adopt it for the
  polling screens (AI jobs, taxonomy admin, job badge, queue stats) and
  retire the hand-written pause/abort code there, or remove the dependency
  (M03). Recommended: adopt it together with M05, when those screens'
  data loading is rewritten anyway.
- **Headless primitives** (Radix, already used for the tooltip) for the
  widgets not yet built accessibly: combobox (user/taxonomy pickers), menus,
  select. Keep `Modal.tsx`. shadcn/ui is optional: use it as a source of
  component code to copy, not as a wholesale restyle; keep the teal theme.
- Split the 1,000-line labelling page and taxonomy admin client (W09 open
  item) along the seams these create: data hooks, dialogs, panels.
- Open W09 checks (contrast, narrow viewports, keyboard panel resizing):
  add `@axe-core/playwright` to the existing journeys so contrast and naming
  regressions fail CI.

### M07 PostgreSQL 18 and search (P2, M; after W12 backups)

- Upgrade 16 → 18 only once W12's off-host backups exist and a restore drill
  on a real dump has passed. Dump/restore is simplest at this data size.
  The official 18 image changed its data directory layout, so the volume
  mount changes in both Compose files and in `scripts/restore-drill.sh`;
  update the CI service image and the "tested version" note in DEPLOYMENT.md.
- Queue text search uses `contains` with `mode: 'insensitive'` across five
  columns, which cannot use the B-tree index on `field1`. Add `pg_trgm` GIN
  indexes on the searched columns (raw SQL migration), measured with
  `EXPLAIN ANALYZE` on representative data as W08 asks.
- Use Prisma TypedSQL for the team metrics that still query per member (W08
  open item).
- Keep `cuid` IDs.

### M08 Release and observability (P1; closes W03/W12 open items)

- **Promote the tested image** (W03 open): CI builds the image once, pushes
  it to GHCR tagged with the commit, scans it (Trivy) and records an SBOM;
  Coolify deploys that image by digest instead of rebuilding from git. The
  `/api/health` release check then compares against the exact tested artifact.
- **Structured logs** (W12 open): pino with JSON output and redaction (no
  record contents, passwords or tokens), a request ID set in `proxy.ts` and
  passed to AI calls and audit entries.
- **Traces/metrics:** OpenTelemetry through the existing `instrumentation.ts`
  (Next's built-in support), exported only when an OTLP endpoint is
  configured. Alerts for failed deploys and stuck AI jobs build on these.
- Read-only root filesystem and limits stay as W12 describes.

### M09 Taxomind contract (P2, S)

`lib/ai-labeling.ts` types Taxomind's requests and responses by hand, and
`lib/ai-results.ts` validates results after the fact. If Taxomind publishes
an OpenAPI document, generate types with `openapi-typescript` and call it via
`openapi-fetch`; otherwise put zod schemas for the boundary in
`lib/contracts/taxomind.ts`. Reuse the stub HTTP service from
`tests/integration/ai-job-monitor.test.ts` as the contract test. W07's
idempotent job start (send `batchId`, let Taxomind deduplicate) belongs here
if Taxomind supports it.

## Order

| Phase | Items | Notes |
| --- | --- | --- |
| 1 — upgrade train | M01, M02, M03 | One commit per upgrade (Next 16, ESLint 10, Prisma 7, Vitest 5, Playwright, TS 6). CI fully green after each. Clears the accepted audit findings. |
| 2 — foundations | M04 decision, M05 | Decide M04 before U3/U5 are built. M05 before U2 so the Team page uses the data layer. U1 can go ahead in parallel (it only touches `checkSession()`). |
| 3 — features on top | user management U2–U6, M06 | U2 is the first user of TanStack Table and nuqs. |
| 4 — operations | M08, W12 backups, then M07, M09 | PostgreSQL upgrade only with a tested restore. |

Feature work outside auth, data loading and the queue UI can start after
phase 1.

## Deliberately not doing

- Rewriting on another framework (TanStack Start, React Router, SvelteKit,
  SPA + separate API). See "Answers to the big questions".
- Replacing Prisma with Drizzle or raw SQL.
- A job queue library, Redis, a broker, or a separate worker service.
- Edge runtime anywhere.
- Prisma 8 before general availability.
- Switching package manager (npm with a lockfile is reproducible now).

## Decisions for the maintainer

1. **M04:** move to Better Auth (one forced sign-in for everyone), or stay on
   next-auth beta.32 and build user management on `sessionVersion`?
2. **M08:** build the image in CI, push to GHCR and have Coolify deploy it by
   digest, or keep Coolify building from git?
3. **M06:** adopt TanStack Query for the polling screens, or remove it?
4. **M07:** maintenance window and acceptable downtime for PostgreSQL 18.

## Sources

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Prisma 7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Auth.js is now part of Better Auth](https://github.com/nextauthjs/next-auth/discussions/13252)
- [Better Auth security update, July 2026](https://better-auth.com/blog/security-update-july-2026)
- Package versions: npm registry, 21 October 2026. Node.js release lines:
  `nodejs.org/dist/index.json`, 21 October 2026.
