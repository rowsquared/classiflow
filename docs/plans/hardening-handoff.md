# Hardening work: handoff

**Status:** 21 October 2026, after the W03 (Node 24, lockfile, dependency triage)
and W12 (Compose secrets, runtime DB role, release health, restore drill) commits.
**Pushing:** push only with the maintainer's go-ahead.
**Staging deploys nothing at the moment (as of 21 October 2026):** a push to
`staging` runs CI but no staging environment is updated. Do not treat a push as
deployed or verified on staging; CI's `smoke` job is the only running check of
the image. When staging deploys again, delete this note.

Start here if you are continuing the hardening work from the
[review](../reviews/2026-10-21-review.md). Each workstream in the
[briefs](../reviews/hardening-workstreams.md) has a **Status** block listing what
is done (with the verifying test) and what remains. Read the brief you work on,
not all of them.

## Decisions already taken (do not re-ask)

- Supervisors see and manage their **whole subtree** of the team tree.
- One human label set per record and taxonomy; saving **replaces** it.
  Independent double annotation is a wanted future feature: [ideas](../ideas.md).
- Session revocation is **immediate**: `requireSession()` re-reads role, reset
  flag and `sessionVersion` from the database on every API call.
- Work is committed on `staging`, one commit per meaningful step, and pushed
  only when the maintainer says so.

## Where things stand

| WS | State | Remaining |
| --- | --- | --- |
| W01 access | done | audit logging of denials (W12) |
| W02 sessions | done | MFA/SSO is a product decision |
| W03 dependencies | mostly done | Next 16 / Prisma 7 upgrades (clear the accepted audit findings); promote tested image (W12); pin action SHAs |
| W04 HTTP | mostly done | CSP (report-only first); verify live proxy settings |
| W05 labelling | done | run `scripts/label-integrity-report.sql` on production; decide repairs |
| W06 import/export | done | streaming export for large data |
| W07 AI | done in code | verify against a running Taxomind; idempotent job start (needs Taxomind support) |
| W08 metrics | correctness done | performance tuning with measured data |
| W09 UI | mostly done | stats staleness indicator, contrast/narrow viewports, labelling save errors, component size |
| W10 tests/CI | mostly done | more journeys (imports, admin, comments); shared filter-param builder; build-time check bypass |
| W11 docs | done | keep the map in README/AGENTS current |
| W12 ops | in progress | backup schedule/objectives (maintainer), audit events, upgrade test from a real dump, container limits |

Suggested next order: W12 audit events, then the smaller open items in each brief.

## How to work here

- Read `AGENTS.md` first. Shared rules live in: `lib/api-auth.ts` (session),
  `lib/access.ts` (record scope), `lib/label-path.ts` + `lib/annotation-status.ts`
  (labelling), `lib/taxonomy-csv.ts` (taxonomy files), `lib/csv.ts` (export),
  `lib/ai-results.ts` (AI results). Access matrix: [security](../security.md).
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, and the integration
  suite (needs PostgreSQL; see `tests/integration/README.md`):

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
