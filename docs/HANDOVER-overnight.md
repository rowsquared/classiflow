# Overnight handover (21–22 October 2026)

What landed on `staging` overnight, what to check first, and what is still
open. The plans' "Implementation status" sections hold the details; this page
is the review guide. Delete it once reviewed.

## What landed

One commit per work package, on top of `addc0a7`:

| Commit | Contents | Plan |
| --- | --- | --- |
| `feat(ops)` | pino JSON logs with redaction, request IDs (`x-request-id`, on audit entries), OpenTelemetry traces when an OTLP endpoint is set, read-only container filesystem, `scripts/restore-check.ts` in the restore drill, journeys for taxonomy admin and bulk labelling | modernization M08, workspace P7 |
| `feat(ai)` | Per-workspace AI: platform-approved Taxomind services, write-only encrypted tokens per workspace (connection versions), typed job input tables, persisted taxonomy-sync job, job ceilings, leases released on shutdown, Taxomind cancel on archive, taxonomy delete call removed, typed taxonomy payloads | workspace P6/P7, modernization M09 |
| `feat(accounts)` | Mail through the n8n webhook with an outbox, forgot/set password links, invitations (new accounts and workspace invitations), emailed temporary passwords, CSV member import, email change, mail events and "added by" in the audit/drawer, membership audit in the same transaction | user management U7a/U7c/U7b/U4/U3/U6, workspace P4/P7 |
| `feat(progress)` (backend) | `LabelingActivity` written in the label transactions, grouped `overview`/`activity`/`people` reports, reporting time zone, benchmark seed, trigram queue search | progress D0–D2, modernization M07 |
| `feat(frontend)` ×2 | TanStack Query everywhere (no hand-written polling left), URL state with nuqs (queue, team, audit, progress), Radix pickers, labelling page and taxonomy admin split, workspace switcher, axe-core on every screen, React Compiler lint rules back to errors | modernization M06, workspace P5 switcher |
| `feat(progress)` (UI) | New Progress dashboard; old `stats`/`timeline`/`team` endpoints removed | progress D3/D4 |
| `chore`/`fix` | ESLint boundary for the `prisma` singleton, logger instead of `console` in server code, Dockerfile copies `lib/account-links.ts` (the container did not start) plus a test that checks the list | workspace P7 |

Five new migrations after the baseline (`20261022100000` … `20261022130000`).
The AI migration deletes existing AI job rows (none exist under the fresh
start).

Verified locally on the merged result: typecheck, lint (0 problems),
Prettier, 138 unit tests, 166 integration tests (PostgreSQL 16), production
build, 40 browser journeys. CI on `staging` (PostgreSQL 18, Docker smoke
image) was run by hand; see the Actions tab for the latest run.

## Check first

1. **New settings for staging** (ENV_SETUP.md): `AI_CREDENTIALS_KEYS` (needed
   for any AI; `AI_LABELING_API_KEY` is no longer read, each workspace enters
   its own token under Admin › AI Settings), `N8N_EMAIL_WEBHOOK_SECRET` and
   `APP_BASE_URL` (mail is off without them), optional `REPORTING_TIMEZONE`,
   `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
2. **Read-only container**: Compose now runs the app with `read_only: true`
   and tmpfs for `/tmp` and `/app/.next/cache` (DEPLOYMENT.md "Container
   hardening"). Check Coolify honours it.
3. **Behaviour changes users will notice**: the queue keeps old rows dimmed
   while loading; the comment dialog stays open after saving; "Up" in the
   taxonomy browser goes one level up; primary buttons use the theme teal
   (`indigo-600`) for contrast; the queue clears its selection after a bulk
   label; the Progress page is new.
4. **Decisions taken with the plans' defaults** (change them if you disagree):
   n8n only, no SMTP; password links stored hashed in Better Auth's
   `Verification` table instead of signed tokens; 3 AI jobs per workspace and
   10 overall; any approved AI service is open to every workspace; reporting
   time zone per workspace with a deployment default (UTC).

## Still open

Code, smaller items: request ID passed to Taxomind (calls come from
background monitors), alerts (need a log/trace backend), memory/CPU limits
(need production numbers), automatic `OutgoingMail` retention, "Export users"
CSV, approving AI services per workspace, per-workspace AI thresholds,
TanStack Table for the team list (optional), removing hand-written
`useMemo`/`useCallback` (optional), people-table row for platform admins
without a membership, paged pickers on the Progress page, the D4 benchmark on
a staging-like host.

Yours, not code: staging and production setup, the live reverse-proxy check,
backup targets (data loss and downtime you accept), the audit retention
period, making the `e2e` check required on `main`, trying mail against the
real n8n workflow. Taxomind side: deduplicate by `batchId`, a taxonomy delete
action, and verifying namespace isolation (the release gate for enabling AI
for independent workspaces; until then give them separate Taxomind
credentials or instances).
