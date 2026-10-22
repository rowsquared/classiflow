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

## 2. Decisions (taken 22 October 2026) and what they still need

- **Backups** (W12): nightly custom-format dumps, kept 30 days off the
  server, encrypted; tolerated loss up to one day of work. Still to do: set up
  the schedule (Coolify's scheduled database backups to S3, or `pg_dump` from
  DEPLOYMENT.md "Backups") with an alert when it fails, keep a copy of
  `AI_CREDENTIALS_KEYS` apart from the dumps, and run
  `scripts/restore-drill.sh` on a real dump once on staging, then quarterly.
  - [ ] Backup schedule and off-server storage
  - [ ] Restore drill on staging
- **Audit log retention:** two years. Done in code: each instance deletes
  older entries every six hours (`AUDIT_RETENTION_DAYS`, default 730; `0`
  keeps them). Mail outbox rows: 90 days (`MAIL_RETENTION_DAYS`).
- **Required check:**
  - [ ] Add the `e2e` CI job to the `main` ruleset (GitHub › Settings › Rules;
        `deploy-prod` already waits for it). Before the first production
        release.
- **Later, not needed for staging:**
  - [ ] Container memory/CPU limits, sized from staging usage (Coolify or the
        placeholders in `docker-compose.yml`).
  - [ ] Alerts: choose a log/trace backend (logs are JSON on stdout, traces
        go to `OTEL_EXPORTER_OTLP_ENDPOINT`); then alert on 5xx rates, failed
        AI jobs and failed mail.
  - [ ] Admin MFA/SSO (W02): Better Auth offers 2FA, passkeys and OIDC/SAML;
        needs its own plan.
- **Defaults confirmed:** mail through n8n only (no SMTP); password links
  hashed in Better Auth's `Verification` table; 3 AI jobs per workspace and 10
  overall; approved AI services open to every workspace unless restricted
  ("Access"); reporting time zone per workspace, deployment default UTC.

## 3. AI on staging

- [ ] **Try AI end to end** on staging: approve the Taxomind URL, have a
      platform admin enter the token in a workspace's AI settings, then sync,
      label and learn (so far only the contract-checked stub has been used).
      Check Taxomind's logs show the `x-request-id` classiflow sends.

Longer-term Taxomind work (tokens bound to namespaces, idempotent starts,
taxonomy delete) is in [Taxomind: isolation and robustness](taxomind.md). It
is only needed before offering AI to an organisation whose admins should not
reach other workspaces' models.

## 4. Optional code

- [ ] TanStack Table for the Team list (the hand-made table is small and
      tested).
- [ ] Remove hand-written `useMemo`/`useCallback` where the React Compiler
      covers them (M01).

Independent double annotation now has a proposed
[implementation plan](double-annotation.md); it is not implemented. Other
product ideas are in [ideas.md](../ideas.md).
