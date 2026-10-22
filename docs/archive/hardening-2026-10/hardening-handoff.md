# Hardening work: handoff

> **Archived 21 October 2026.** Historical record of the hardening round. Current follow-ups are in [open items](../../plans/open-items.md); the remaining-work table below records the state at handoff, before modernization. Links to source files point at the current code, which may have changed since.

**Status:** 21 October 2026. All workstreams are done or mostly done in code; what
is left needs production data, a decision, or its own upgrade plan (table below).
**Pushing:** push only with the maintainer's go-ahead.
**Staging status (updated 22 October 2026):** no staging environment is
configured, and pushes to `staging` do not run CI. Start CI manually before
promotion (`gh workflow run CI --ref staging`); see COOLIFY_DEPLOYMENT.md
"Deploy triggers". A push does not establish deployment or staging verification.

Start here if you are continuing the hardening work from the
[review](2026-10-21-review.md). Each workstream in the
[briefs](hardening-workstreams.md) has a **Status** block listing what
is done (with the verifying test) and what remains. Read the brief you work on,
not all of them.

## Decisions already taken (do not re-ask)

- Supervisors see and manage their **whole subtree** of the team tree.
- One human label set per record and taxonomy; saving **replaces** it.
  Independent double annotation is a wanted future feature: [ideas](../../ideas.md).
- Session revocation is **immediate**: `requireSession()` re-reads role, reset
  flag and `sessionVersion` from the database on every API call.
- Work is committed on `staging`, one commit per meaningful step, and pushed
  only when the maintainer says so.
- Audit trail covers administrative changes and refused access, not individual
  label saves, comments or flags (those rows carry author and time).
- Node 24 LTS and a committed npm lockfile; Next 16 and Prisma 7 are separate
  upgrade plans, not part of hardening: see the
  [modernization plan](../plans-2026-10/modernization-2026-10.md).

## Where things stand

| WS | State | Remaining |
| --- | --- | --- |
| W01 access | done | — |
| W02 sessions | done | MFA/SSO is a product decision |
| W03 dependencies | mostly done | Next 16 / Prisma 7 upgrades (clear the accepted audit findings); pin action SHAs. Image promotion dropped: Coolify builds from git |
| W04 HTTP | mostly done | enforce the report-only CSP after watching production; verify live proxy settings |
| W05 labelling | done | run `scripts/label-integrity-report.sql` on production; decide repairs |
| W06 import/export | done | — |
| W07 AI | done in code | verify against a running Taxomind; idempotent job start (needs Taxomind support) |
| W08 metrics | correctness done | performance tuning with measured data |
| W09 UI | mostly done | contrast/narrow viewports, component size |
| W10 tests/CI | mostly done | more journeys (taxonomy admin, team, bulk label); shared filter-param builder |
| W11 docs | done | keep the map in README/AGENTS current |
| W12 ops | mostly done | backup schedule/objectives (maintainer), upgrade test from a real dump, structured logs/alerts, read-only FS and limits |

Suggested next order: the smaller open items in each brief (see the `[ ]` lines).

## How to work here

- Read `AGENTS.md` first. Shared rules live in: `lib/api-auth.ts` (session),
  `lib/access.ts` (record scope), `lib/label-path.ts` + `lib/annotation-status.ts`
  (labelling), `lib/taxonomy-csv.ts` (taxonomy files), `lib/csv.ts` (export),
  `lib/ai-results.ts` (AI results). Access matrix: [security](../../security.md).
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, the integration
  suite (needs PostgreSQL; see `tests/integration/README.md`) and, for UI
  changes, the browser journeys (`npm run build`, then `npm run test:e2e`; see
  `tests/e2e/README.md`):

  ```bash
  npm run db:up
  docker exec classiflow-dev-postgres createdb -U classiflow classiflow_test
  TEST_DATABASE_URL=postgresql://classiflow:classiflow_password@localhost:5434/classiflow_test npm run test:integration
  ```

  In a cloud sandbox without Docker, point `TEST_DATABASE_URL` at any
  disposable PostgreSQL 16 database whose name ends in `_test`; CI's
  `integration` job does the same with a service container.
- For every behaviour change, add an integration test and check that it fails
  on the old code (`git stash push -- <route files>`, run, `git stash pop`).
- When you finish a step, tick it in the brief's Status block and the review's
  priority table, and commit only your files.

## Things the maintainer must do outside the code

**Fresh start (decided 21 October 2026):** no staging or production
deployment exists and no data is kept; both are set up again (see the
[modernization plan](../plans-2026-10/modernization-2026-10.md), M00). Items below about
existing databases (the backup-table check, the old fallback DB password,
running the label-integrity report on production) no longer apply. The
required variables (`POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`,
`DEFAULT_ADMIN_PASSWORD`) and the reverse-proxy settings still do.

- Optionally add the new `e2e` CI job as a required check in the `main` ruleset
  (`deploy-prod` already waits for it).
- After deploying: check `classiflow_backup."SentenceAnnotationDuplicate20261021"`
  (rows removed by the unique-label migration), then drop the schema.
- Reverse proxy: forward `Host`, 50 MB body limit, rate-limit
  `POST /api/auth/callback/credentials`, add HSTS (DEPLOYMENT.md "Reverse proxy").
- Before the first deploy of these commits, make sure production has a real
  `DEFAULT_ADMIN_PASSWORD` if the database could ever start without an admin;
  placeholders now stop startup.
- **Before deploying the W12 commit** (staging and production): set
  `POSTGRES_PASSWORD` and `NEXTAUTH_SECRET` in Coolify, or the deploy fails. If
  the database was created with the old fallback, set `classiflow_password`
  first and then rotate it (DEPLOYMENT.md "Upgrading an existing Compose
  deployment"). Recommended: `APP_DB_USER`/`APP_DB_PASSWORD`, Coolify's
  "Include Source Commit in Build", and the repository variable `PROD_HEALTH_URL`.
- Decide backup objectives and schedule off-host encrypted dumps; run
  `scripts/restore-drill.sh` on a real dump.
- After the first deploy with these commits: watch browser consoles for
  Content-Security-Policy reports; if there are none, enforce it (rename the
  header in `next.config.ts`). Choose an audit-log retention period.
- Pin the GitHub Actions in `.github/workflows/ci.yml` to commit SHAs (the
  agent could not read the actions' repositories).
