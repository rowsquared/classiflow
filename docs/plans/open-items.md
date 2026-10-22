# Open items (after the October 2026 rounds)

The modernization, workspace isolation, user management and progress
dashboard plans are implemented and archived in
[`docs/archive/plans-2026-10/`](../archive/plans-2026-10/). This page is the
one list of what they left open. Almost none of it is code in this
repository: it needs a running staging environment, a decision by the
maintainer, or work in Taxomind. Strike an item through (or delete it) when it
is done; move new work into its own plan.

## 1. Staging (first)

Nothing deploys from `staging` yet (COOLIFY_DEPLOYMENT.md "Deploy triggers").

- [ ] **Set up staging** on Coolify from COOLIFY_DEPLOYMENT.md, PostgreSQL 18,
      with the runtime database role (`APP_DB_PASSWORD`, DEPLOYMENT.md
      "Database roles").
- [ ] **Settings added in October** (ENV_SETUP.md): `AI_CREDENTIALS_KEYS`
      (needed for any AI; `AI_LABELING_API_KEY` is no longer read, each
      workspace enters its own token), `AI_SOURCE_SLUG` (different from
      production), `N8N_EMAIL_WEBHOOK_SECRET` and `APP_BASE_URL` (mail is off
      without them), optional `REPORTING_TIMEZONE`, `LOG_LEVEL`,
      `OTEL_EXPORTER_OTLP_ENDPOINT`, `MAIL_RETENTION_DAYS`.
- [ ] **Read-only container:** check that Coolify honours `read_only: true` and
      the tmpfs mounts (DEPLOYMENT.md "Container hardening").
- [ ] **Reverse proxy check** (W04): `Host` forwarded, HSTS, 50 MB body limit,
      rate limit on the sign-in endpoint (DEPLOYMENT.md "Reverse proxy").
- [ ] **Mail against the real n8n workflow:** invite a test member, open the
      link, set a password; forgot-password; check the Team page's mail status.
      Only the mock webhook has been used so far.
- [ ] **Progress benchmark (D4)** on staging-like data: 10 viewers plus
      labeling writes, browser timings against the budget in the archived
      progress plan ("Performance budget and evidence"); `scripts/bench/seed-progress.ts`.
- [ ] **Smoke test the October changes users will notice:** new Progress
      page (server-searched team/person pickers), queue keeps old rows dimmed
      while loading and clears its selection after a bulk label, comment dialog
      stays open after saving, "Up" in the taxonomy browser goes one level up,
      teal primary buttons, Team page "Export CSV", AI settings "Job settings",
      AI service "Access" on the Workspaces page.

## 2. Decisions for the maintainer

- [ ] **Backups** (W12): tolerated data loss and recovery time; then off-host
      encrypted dumps on a schedule, retention, an alert on failure, and
      `scripts/restore-drill.sh` on a real dump, including restoring the AI
      token key (`AI_CREDENTIALS_KEYS`, DEPLOYMENT.md "AI credentials").
- [ ] **Audit log retention** period (pruning is SQL, DEPLOYMENT.md "Audit
      log"). Mail outbox rows are pruned automatically (90 days by default).
- [ ] **Required check:** add the `e2e` CI job to the `main` ruleset
      (`deploy-prod` already waits for it).
- [ ] **Container memory/CPU limits**, sized from staging/production usage.
- [ ] **Alerts:** choose a log/trace backend (logs are JSON on stdout, traces
      go to `OTEL_EXPORTER_OTLP_ENDPOINT`); then alert on 5xx rates, failed AI
      jobs and failed mail.
- [ ] **Admin MFA/SSO** (W02): Better Auth offers 2FA, passkeys and OIDC/SAML.
- [ ] **Defaults chosen overnight**, change them if you disagree: n8n only (no
      SMTP); password links hashed in Better Auth's `Verification` table; 3 AI
      jobs per workspace and 10 overall; approved AI services open to every
      workspace unless restricted; reporting time zone per workspace,
      deployment default UTC; mail outbox kept 90 days.

## 3. Taxomind (release gate for AI)

- [ ] **Namespace isolation verified live:** two namespaces with one
      credential and identical taxonomy keys must not see each other's models.
      Until then give independent workspaces separate Taxomind credentials or
      instances (or open a service only to one workspace: "Access" on the
      Workspaces page).
- [ ] **Idempotent start** (W07): Taxomind should return the existing job for
      a repeated `(sourceSlug, batchId)` on `/label` (and `/learn` needs a batch
      id). Until then an instance that dies between `POST /label` and saving
      the job id makes recovery send the batch again.
- [ ] **Taxonomy delete action** in Taxomind; then add it here as a job kind
      (deleting a taxonomy leaves its model in Taxomind until a sync replaces
      it).
- [ ] **End-to-end run** of sync, labeling and learning against a real
      Taxomind on staging (so far only the contract-checked stub). Taxomind
      receives `x-request-id` on every call; check its logs show it.

## 4. Optional code

- [ ] TanStack Table for the Team list (the hand-made table is small and
      tested).
- [ ] Remove hand-written `useMemo`/`useCallback` where the React Compiler
      covers them (M01).

Product ideas without a plan are in [ideas.md](../ideas.md) (independent
double annotation).
