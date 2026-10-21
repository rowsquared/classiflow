# classiflow hardening investigation briefs

Companion to the [21 October 2026 review](2026-10-21-review.md). These are proposed
assignments, not approved implementation designs or a record of completed fixes.
All evidence refers to `8c037de`; recheck the current checkout. Taxomind changes
are excluded. Its existing API can be stubbed when testing classiflow.

**Concurrent cleanup:** read the review's
[handoff status](2026-10-21-review.md#changes-observed-during-the-review) first.
W01's missing guards/authorship are partly addressed by other uncommitted work;
the helper still needs record scope and session-lifecycle review. External
training, its queue helper, and several scripts are being removed. Treat those
findings as historical/removal-verification tasks if the deletion lands; do not
restore the feature to fix it. Historical sources can be inspected with
`git show 8c037de:<repository-relative-path>`.

## How to assign a brief

Give an agent one W-number and this instruction:

> Investigate Wxx in `docs/reviews/hardening-workstreams.md`. Read AGENTS.md and
> only the source/docs relevant to that brief. Confirm or refute the evidence
> against the current commit. Produce a dedicated implementation plan with
> concrete changes, policy decisions, dependencies, tests, migration/backfill
> needs, rollout/rollback, and small proposed PR boundaries. Separate observed
> bugs from hypotheses. Preserve human-only operation and string codes with
> leading zeros. Keep work within classiflow. This assignment is planning only.

Save a resulting plan under `docs/plans/Wxx-<topic>.md` and add its link to the
review's priority table when it exists. Do not create empty plans for every
topic. Each plan should carry a baseline commit, status, owner, and verification
date; close findings with evidence rather than deleting their history.

## W01 API authorization

**Priority:** P0. **Dependencies:** coordinate the current-user guard with W02;
write regression tests immediately, without waiting for broad W10 cleanup.

**Read:** [middleware](../../middleware.ts), the review's
[unguarded route inventory](2026-10-21-review.md#1-application-api-access-control-is-incomplete),
[annotation writes](../../app/api/sentences/[sentenceId]/annotations/route.ts),
[bulk writes](../../app/api/sentences/bulk-label/route.ts),
[assignments](../../app/api/sentences/assign/route.ts),
[user detail](../../app/api/users/[userId]/route.ts), and
[record detail](../../app/api/sentences/[sentenceId]/route.ts).

**Evidence:** unguarded destructive/import/comment routes; comments use the first
database user as author. Annotation routes lack record visibility checks.
Assignment GET exposes assignments for supplied IDs; POST restricts supervisor
target users but not target records; DELETE restricts neither target to the
supervisor's scope. Any signed-in user can read arbitrary user details, including
email, hierarchy, last login, and work counts. Decide which profile fields are
intended to be shared rather than assuming all directory access is prohibited.

**Investigate and plan:**

- Produce a method-by-method access matrix for every API: anonymous, reset-required,
  labeller, supervisor, admin; include record and team scope and explicit public exceptions.
- Establish small reusable current-user, role, and record-scope helpers. Enforce
  them in handlers; page gating is an additional usability measure.
- Define whether supervisors may acquire unassigned records, see all team
  assignments, resolve another user's comment, and delete comments. Reuse the
  same team traversal in queue, detail, statistics, assignments, and progress.
- Reject mixed authorized/unauthorized bulk requests atomically, or explicitly
  design partial success with callers; do not silently modify unauthorized rows.
- Attribute imports/comments/changes to the authenticated actor. Review AI-job
  detail/history and directory APIs for minimum necessary disclosure too.

**Acceptance:** anonymous writes return 401 without database/external side effects;
wrong roles and cross-team access are denied; a labeller cannot alter an
unassigned record by supplying its ID; bulk authorization cannot be bypassed by
one valid ID; comment authorship is accurate. Test all HTTP methods, direct API
calls, deep supervisor trees, and missing/deleted users on an isolated database.

**Suggested split:** urgent missing guards and authorship; shared scope policy
with parity tests; consistent coverage of remaining read APIs.

**Status (21 Oct 2026): done.** Access matrix in [docs/security.md](../security.md).

- [x] Every API handler goes through `requireSession()` (`lib/api-auth.ts`);
      only `/api/health` and Auth.js protocol routes are public.
- [x] One record-scope policy in `lib/access.ts` (whole supervisor subtree,
      cycle-safe BFS, depth limit) used by queue, stats, detail, annotations,
      bulk labels, comments, flags, assignments, users and progress. The old
      two-level queue/stats/assign traversal and the recursive, cycle-unsafe
      progress traversal are gone.
- [x] Writes require the same scope as reads; bulk label and assignment
      requests are all-or-nothing (403, no rows changed).
- [x] Assignments: supervisors only assign visible records to their own team;
      DELETE without `userIds` only removes their team's assignments.
- [x] User directory: supervisors list only their team; user detail is limited
      to self / team / admin. AI job list/detail are admin-only; imports list is
      admin-only (only admin pages use it).
- [x] Comment author is the signed-in user; deletion is author-or-admin;
      resolving is open to anyone who can see the record.
- [x] Regression tests: `tests/integration/access-control.test.ts` (17 cases:
      anonymous, labeller, deep supervisor tree, cross-team, bulk bypass,
      assignment scope, comment ownership). 13 of them fail on the previous
      route code.

Done since, in other workstreams: denials are audited (`access.denied`, W12)
and custom routes have an Origin check (W04).

## W02 Identity and session lifecycle

**Priority:** P0 for default credentials/logging when deployed; P1 for lifecycle
hardening. **Dependencies:** common guard contract with W01; runtime upgrades W03.

**Read:** [auth config](../../lib/auth.config.ts), [JWT callbacks](../../lib/auth.ts),
[password reset](../../app/api/auth/reset-password/route.ts),
[user mutations](../../app/api/users/[userId]/route.ts),
[bootstrap](../../scripts/init-admin.js),
[password recovery script](../../scripts/reset-admin-password.ts),
[queue scope](../../app/api/sentences/route.ts), and [schema](../../prisma/schema.prisma).

**Evidence:** bootstrap and recovery scripts print passwords and accept known
fallbacks. JWT roles/reset flags refresh only on sign-in or explicit session
update. Business APIs do not enforce mandatory password reset. Queue supervisor
scoping fails open if the JWT identifies a supervisor absent from the database.
No application login throttling was found; an upstream control remains unverified.

**Investigate and plan:**

- Remove credential output and require explicit, validated bootstrap secrets
  outside isolated development/test setup. Give bootstrap failures a clear exit
  status; currently initialization catches failures and allows startup to proceed.
- Specify revocation after password changes, admin reset, role change, and user
  deletion. Compare DB-backed current-user checks and a session-version approach;
  choose the smallest design meeting the policy, with a migration if necessary.
- Enforce reset-required restrictions server-side while allowing the reset and
  authentication flows needed to recover. Deny nonexistent users consistently.
- Add bounded credentials inputs and distributed or ingress-backed login abuse
  controls. Check generic error responses and whether logs need user identifiers.
- Validate supervisor assignments against self-links/cycles and invalid roles;
  define safeguards for deleting or demoting the last admin.
- Evaluate admin MFA/SSO as a subsequent product decision, not a prerequisite for
  closing the current credential/session holes.

**Acceptance:** an existing session loses privileges after demotion, deletion,
or forced reset within a documented bound; resetting a password invalidates old
sessions according to policy; business APIs cannot bypass initial reset; no
password appears in captured setup/recovery logs; bootstrap is idempotent and
does not unexpectedly overwrite existing accounts.

**Status (21 Oct 2026): done for classiflow code;** two items depend on hosting (W12).

- [x] Immediate revocation: `requireSession()` reads role, `mustResetPassword`
      and the new `User.sessionVersion` from the database on every API call.
      Deleted users get 401; demotion applies on the next request; any password
      change (self-service or admin-set) bumps `sessionVersion`, ending older
      sessions. `trigger: 'update'` cannot refresh the version, so a revoked
      session cannot revive itself. Verified in tests and live in the browser.
- [x] Mandatory reset enforced server-side: 403 `PASSWORD_RESET_REQUIRED` on all
      business APIs; only `/api/auth/reset-password` admits such users.
- [x] Queue supervisor fail-open fixed (nonexistent users are rejected up front).
- [x] Login: bounded inputs, per-identifier throttle (5 failures / 15 min,
      in-process, documented limits), dummy-hash comparison for unknown users,
      no identifiers in login logs.
- [x] Supervisor links validated (no self, no cycles, supervisor must be admin
      or supervisor); last admin cannot be demoted; self-deletion was already
      blocked.
- [x] `scripts/init-admin.js`: idempotent (skips when any admin exists, never
      touches existing accounts), never prints the password, requires
      `DEFAULT_ADMIN_PASSWORD` only when creating, refuses placeholders in
      production, exits non-zero on failure (startup stops). Tested all paths
      against the test database.
- [x] Recovery: `scripts/reset-admin-password.js` (plain Node, runs in the
      container) replaces the TypeScript script that could not run there. Takes
      the password from `NEW_PASSWORD`, admins only, forces reset, bumps
      `sessionVersion`, prints no secret. DEPLOYMENT/COOLIFY docs corrected (they
      claimed changing the env var resets an existing admin).
- [x] Compose no longer supplies a fallback admin password.
- [x] Deleting a user who authored comments or AI jobs returns 409 with an
      explanation instead of a foreign-key 500 (test added). Deactivation
      instead of deletion is listed in [ideas](../ideas.md).
- [x] Database fallback password `classiflow_password` in Compose: removed in
      W12 (`POSTGRES_PASSWORD` is required; upgrade path in DEPLOYMENT.md).
- [ ] Admin MFA/SSO: product decision, not started.

## W03 Dependencies and reproducible releases

**Priority:** P1; escalate any confirmed reachable critical advisory to P0.
**Dependencies:** W10 CI, W12 release operation. An intentional lockfile-policy
change belongs in its own plan; do not introduce one incidentally.

**Read:** [manifest](../../package.json), [.npmrc](../../.npmrc),
[Dockerfile](../../Dockerfile), [CI](../../.github/workflows/ci.yml),
[release script](../../scripts/promote-main.mjs), and the review's measured baseline.

**Evidence:** floating dependency ranges and disabled/ignored lockfiles mean
separate CI/Coolify builds can resolve different graphs. Docker installs twice
and copies all `node_modules`, including development tooling, into the runner.
The CI test environment is another independent install. Docker/CI use Node 20,
which has reached EOL. The local audit reports 17 affected package entries,
including Auth.js, CSV parsing, Prisma tooling, and Vitest dependency paths.

**Investigate and plan:**

- Inventory installed and deployed versions, transitive paths, runtime versus
  build-only reachability, and container OS packages. Keep Prisma CLI/client aligned.
- Triage each advisory by the actual feature path and current upstream fix. For
  example, credentials-only auth does not by itself exercise email magic-link
  normalization. [Auth.js advisory](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh).
  Vitest's UI-server issue requires that server to be listening; it is not proof
  of a production Next.js exploit. [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).
- Propose a supported Node LTS and explicit npm version for local/CI/container
  parity. Separate security patches from unnecessary major framework migrations.
- Propose a committed npm lockfile and deterministic installation, updating
  `.npmrc`, ignore rules, Docker, CI, and documentation together if adopted.
- Prefer promoting the tested image digest; otherwise verify the exact commit
  and dependency graph rebuilt by Coolify. A queued deploy response is not
  evidence that the intended version is healthy in production.
- Minimize runner dependencies while preserving Prisma engines, migrations,
  bootstrap, and writable runtime needs. Add recurring dependency/image scans,
  reviewable updates, explicit CI token permissions, and pinned action revisions.

**Acceptance:** two clean builds use the same dependency graph; CI and deployment
identify the tested artifact; the runtime is supported; reachable high/critical
findings are fixed or have an owner and justified temporary mitigation; upgrades
pass auth, migration, import/label/export, and AI-disabled integration checks.

**Status (21 Oct 2026): mostly done.** Decision: Node 24 LTS (supported to
April 2028) and a committed npm lockfile.

- [x] Runtime: Dockerfile, CI (`.nvmrc`) and `package.json` engines use Node 24 /
      npm 11. The base image is pinned by digest.
- [x] Lockfile: `package-lock.json` committed; CI and Docker install with
      `npm ci`; `legacy-peer-deps` and `package-lock=false` removed from `.npmrc`
      (the graph resolves without them). Two builds of one commit now use the
      same dependency graph and base image.
- [x] Image: one install instead of two; the runner carries production
      dependencies only. Verified by running the Compose start command on that
      layout against an empty database (migrations, bootstrap, health, login,
      forced reset); the CI `smoke` job verifies the Alpine image itself.
- [x] CI token limited to `contents: read`; Dependabot (`.github/dependabot.yml`)
      opens weekly npm/Docker and monthly Actions PRs against `staging`.
- [x] Audit triage. Fixed: next-auth beta.29 → beta.32 (fail-open auth object,
      malformed Bearer crash, OAuth cookie binding, email normaliser),
      csv-parse 6 → 7.0.3 (`__proto__` header on the `columns` path, reachable
      through admin record/taxonomy imports), vitest 3 → 4.1.12 (dev: UI server,
      mocker, tinypool). `npm audit` went from 17 entries (4 critical) to 11
      (0 critical, 10 high, 1 moderate). Accepted for now, none reachable from
      requests:
  - `postcss` inside `next` (source-map file reads, stringify XSS): only runs
    at build time on our own CSS. Fix needs Next 16 (major).
  - `effect`, `deepmerge-ts` via `@prisma/config`: CLI config loading at
    migrate/generate time, no untrusted input. Fix needs Prisma 7 (major,
    client/engine migration).
  - `braces`, `micromatch`, `fast-glob` via `eslint-config-next`: lint only.
- [ ] Next 16 and Prisma 7 upgrades (each its own plan; they clear the accepted
      findings above).
- [ ] Promote the tested image instead of rebuilding in Coolify (W12). Until
      then the lockfile and pinned base make a rebuild reproduce CI's graph.
- [ ] Pin GitHub Actions to commit SHAs (Dependabot then keeps them current).
      Not done here: resolving the SHAs means reading the actions' own
      repositories, which this agent's GitHub scope excludes.
- [x] Install scripts approved explicitly in `package.json` `allowScripts`
      (`prisma`, `@prisma/client`, `@prisma/engines`, `unrs-resolver`); `npm ci`
      no longer warns and Prisma engines still install.

## W04 HTTP boundaries and data exposure

**Priority:** P1. **Dependencies:** W01/W02 guards; coordinate uploads with W06/W07
and ingress settings with W12. Exploitability of proxy/storage findings needs
deployment verification.

**Read:** [server fetch](../../lib/server-fetch.ts),
[Next config](../../next.config.ts), [middleware](../../middleware.ts),
[record import](../../app/api/sentences/import/route.ts),
historical `app/api/ai-labeling/external-training/{upload,start}/route.ts`,
[queue API](../../app/api/sentences/route.ts), and [health](../../app/api/health/route.ts).

**Evidence:** server-side fetch constructs an origin from request Host/protocol
headers when no configured base URL exists, then forwards cookies. This creates
a trust-boundary concern; actual SSRF/cookie disclosure depends on accepted proxy
headers and routing and was not reproduced. `CUSTOM_KEY` is placed in Next's
public build-time `env` configuration; no secret value or use was established.
Reviewed upload handlers buffer files without explicit application byte/row
limits. Queue pagination and bulk arrays lack maximum sizes. Error handlers
sometimes return raw exception details. CSP/HSTS are not configured in this
repository, though the ingress may supply them.

Training upload writes to `public/training-data` and returns a URL, without
expiry/cleanup. Do not assume this is already anonymously downloadable: page
middleware covers that path, and serving files created after startup needs
verification. Both confidentiality and reliable service access need redesign.
The directory is also not excluded from Git/Docker runtime-data inclusion.

**Investigate and plan:**

- Use a trusted internal origin or shared server-only data functions for server
  rendering. Preserve current cookies, no-store behavior, and failure fallback;
  do not replace protected fetches with unscoped database reads.
- Verify proxy host allowlisting, forwarded-header handling, HTTPS, secure
  cookies, Origin/CSRF protection for custom mutation APIs, and restrictive CORS.
  Auth.js protocol protections must not be assumed to cover custom route handlers.
- Add schemas and byte/row/field/array/date/pagination bounds, safe error responses,
  rate/concurrency limits, request timeouts, and matching ingress upload limits.
- Store training data privately with explicit retention and short-lived access
  compatible with the existing service contract. Validate that training URLs
  refer to permitted uploads; the current start route accepts any syntactic URL.
  Do not claim classiflow itself fetches that URL: it delegates it to the AI service.
- Evaluate CSP in report-only mode before enforcement, accounting for the inline
  layout script, and identify which security headers belong at the proxy.

**Acceptance:** spoofed Host/forwarded headers cannot redirect authenticated
server fetches; cross-origin mutation tests follow the documented policy;
oversized/malformed inputs return controlled 4xx responses; secrets/internal
errors are absent from responses; training data has tested access and deletion
rules and remains out of source control/images.

**Status (21 Oct 2026): mostly done.**

- [x] `lib/server-fetch.ts` always targets this server on loopback
      (`INTERNAL_APP_URL` override); request Host/X-Forwarded-* no longer
      choose where the session cookie is sent. Verified in the browser.
- [x] Cross-site mutations: middleware refuses non-GET `/api` requests whose
      `Origin` differs from `Host`/`X-Forwarded-Host` (403; unit tests in
      `lib/cross-site.test.ts`, verified live with curl). Auth.js routes keep
      their own CSRF protection; origin-less requests rely on SameSite cookies.
- [x] Bounds: 50 MB upload cap, queue page/limit clamped (1..10000) and sort
      order validated, bulk/assign arrays ≤ 10000, comment/label/password
      lengths, date params validated (progress, labelling start time).
- [x] Responses to non-admin callers no longer carry exception messages or
      stack traces (queue, stats, progress, taxonomies); details stay in logs.
      Admin-only AI routes still return service messages on purpose.
- [x] `CUSTOM_KEY` removed from the public Next `env`; `Referrer-Policy`
      tightened and `Permissions-Policy` added; proxy duties documented in
      DEPLOYMENT.md ("Reverse proxy").
- [x] Training upload: removed with the external-training feature (no
      `public/training-data` writes remain in the code).
- [x] CSP in report-only mode (`next.config.ts`): `'self'` for everything,
      inline scripts/styles allowed (Next hydration, sidebar init script). The
      browser journeys fail on any CSP report, and none occur. Next: enforce
      (rename the header) once production logs show no reports; nonces would
      remove `'unsafe-inline'`.
- [ ] Verify live proxy: Host forwarding, HSTS, body limit, login rate limit
      (needs access to the Coolify host).

## W05 Labeling integrity and concurrency

**Priority:** P1. **Dependencies:** W01 scope helpers; coordinate migrations with
W06 and metric definitions with W08.

**Read:** [schema](../../prisma/schema.prisma),
[individual annotation API](../../app/api/sentences/[sentenceId]/annotations/route.ts),
[bulk API](../../app/api/sentences/bulk-label/route.ts),
[constants](../../lib/constants.ts), [labeling UI](../../app/queue/[sentenceId]/page.tsx).

**Evidence:** bulk writes set `submitted` without checking all active taxonomies,
even with no labels. Individual writes trust client leaf/unknown completeness,
accept numeric codes, and use the first annotation's taxonomy for the whole
array. Completion checks do not filter annotation source. Both paths increment
learning counters outside their label transaction. Schema indexes do not enforce
annotation uniqueness; concurrent behavior requires reproduction.

**Investigate and plan:**

- Define one server-side validator for taxonomy membership, string codes, level
  bounds, unique levels, parent-child path, leaf or level-specific unknown, and
  mixed-taxonomy rejection. Preserve leading zeros end-to-end.
- Define completion, skip, escalation, flag-only, comment-only, and zero-active-
  taxonomy behavior. Human suggestions and completion remain distinct.
- Decide whether independent double annotation is supported. The README claims
  it, while current saves replace a taxonomy's annotations. Do not add a unique
  constraint that silently rules out an intended workflow.
- Choose conflict handling for concurrent editors and taxonomy changes during
  submission: optimistic version check, serialized mutation, or an explicit
  alternative. Transaction wrapping alone does not settle that policy.
- Define the learning counter's unit (records, levels, or new eligible examples),
  make updates atomic, and handle retries/repeated edits without overcounting.
- Profile existing invalid/duplicate/incomplete records before proposing a
  reviewed, reversible repair. Do not automatically relabel production data.

**Acceptance:** one canonical rule set covers bulk and individual writes;
flag/comment-only requests do not complete records; invalid codes/paths are
rejected; another taxonomy's labels survive; simultaneous writes have a defined
outcome; labels, status, counters, and actor metadata stay consistent on failure.

**Status (21 Oct 2026): done.** Decision: one human label set per taxonomy,
saving replaces it (double annotation recorded in [ideas](../ideas.md); README
claims corrected).

- [x] `lib/label-path.ts`: one validator for both endpoints: string codes only
      (numbers rejected), levels 1..N exactly once, within taxonomy depth, root
      and parent-child links, ends in a leaf (legacy null `isLeaf` resolved from
      children) or the level-specific unknown, which must be last. Mixed
      taxonomies in one save are rejected.
- [x] `lib/annotation-status.ts`: one status rule. Complete = every active
      taxonomy has `source='user'` labels (AI suggestions never count; zero active
      taxonomies = not complete). Skip/escalate are explicit. Flag/comment-only
      saves never complete a record or take it out of skipped/escalated. Bulk no
      longer sets `submitted` unconditionally.
- [x] Concurrency: each save locks its records (`SELECT … FOR UPDATE`, id order
      for bulk) so concurrent saves serialise and the last wins as a whole.
      Stale-browser detection (optimistic versions) is not implemented: last
      writer wins, by design for now.
- [x] Unique `(sentenceId, taxonomyId, level)` constraint. The migration copies
      any duplicates to `classiflow_backup."SentenceAnnotationDuplicate20261021"`
      before keeping the newest row per key (verified on seeded duplicates).
      Check that table after deploying; drop it once reviewed.
- [x] Learning counter updated inside the label transaction; unit = label rows
      of a *changed* path (identical re-saves no longer count).
- [x] Tests: `lib/label-path.test.ts`, `lib/annotation-status.test.ts`,
      `tests/integration/labeling.test.ts` (11 cases; 8 fail on the old routes).

- [x] Read-only `scripts/label-integrity-report.sql` lists labels saved before
      validation existed that break the rules (missing codes, gaps, broken
      parents, non-leaf endings, submitted-but-incomplete) and the backup table.

Not done: running that report on production and deciding on any repair (needs
production access; do not auto-relabel).

## W06 Import, export, and taxonomy lifecycle

**Priority:** P1. **Dependencies:** W01/W04; domain invariants W05.

**Read:** [record importer](../../app/api/sentences/import/route.ts),
[export](../../app/api/export/route.ts),
[taxonomy create](../../app/api/taxonomies/route.ts),
[validate](../../app/api/taxonomies/validate/route.ts),
[update/delete](../../app/api/taxonomies/[key]/route.ts),
[existing-taxonomy import](../../app/api/taxonomies/[key]/import/route.ts),
[restore](../../app/api/taxonomies/[key]/restore/route.ts), and schema relations.

**Evidence:** similar CSV validation is repeated across handlers. Export escapes
quotes in selected field/comment values but wraps every cell without centralized
escaping, leaving IDs, headers, or editor names with quotes able to break CSV.
Quoting alone also does not neutralize spreadsheet formulas. Taxonomy deletion
cleans labeling/external-training jobs but omits `AILearningJob`, whose foreign
key can prevent deletion. It requests remote deletion before the local
transaction, so local failure can leave the integration inconsistent. A restore
route remains alongside hard-delete semantics.

**Investigate and plan:**

- Share pure parsing/validation between dry run and commit; revalidate on commit
  and retain transaction-time constraints. Test duplicates, Unicode/BOM, malformed
  rows, leading zeros, unknowns, parent cycles, missing parents, and depth bounds.
- Define replacement versus incremental taxonomy import, and what happens to
  existing labels/suggestions/status when nodes or active taxonomies change.
- Centralize CSV escaping across all cells. Specify a spreadsheet-safe export
  strategy with explicit machine-readable fidelity tradeoffs; do not prefix
  legitimate classification codes indiscriminately.
- Use bounded/chunked reads or streaming for large exports/imports where measured
  size warrants it. Make cancellation, retry, and partial-failure behavior explicit.
- Make deletion aware of every relation and active job. Decide whether restore
  is a supported lifecycle operation or obsolete API; remove only after usage review.

**Acceptance:** dry run and commit agree on validation; exported fixtures parse
with quotes/newlines in every column; formula-leading text follows policy;
leading zeros survive; deletion with completed/active learning jobs has a tested
outcome; records cannot retain silently invalid labels after taxonomy changes.
Document that ordinary export is not directly round-trippable through record import.

**Status (21 Oct 2026): done except streaming.**

- [x] `lib/taxonomy-csv.ts`: one parser for validate, create, replace (PUT with
      file) and incremental import, so dry run and commit cannot disagree.
      Duplicate headers/ids, reserved unknown codes, empty labels, level range,
      level-1-without-parent, parent exactly one level up (rules out cycles and
      the old infinite `inferLevel` loop). `isLeaf`/`path` computed at import
      (create previously left `isLeaf` null). Synonyms split on `, ; |`
      everywhere (create/replace used `,` only).
- [x] Replace vs incremental defined: PUT with a file replaces all nodes and
      sets `maxDepth` to the file's depth; `/[key]/import` only adds nodes
      (parents may be existing nodes), now in one transaction. A replacement
      that drops codes used by human labels or AI suggestions returns 409
      `ORPHANED_LABELS`; the admin UI asks before resending with confirmation.
- [x] Record import: duplicate headers rejected, 50 MB upload cap
      (`lib/upload.ts`), id length bound, error lists capped, uploader recorded
      (`uploadedById`), concurrent duplicate ids return 409 instead of 500.
- [x] Export: `lib/csv.ts` quotes/escapes every cell including headers;
      formula-leading text in field/support/comment/editor columns gets `'`
      (`formulaSafe=false` for raw); ids and codes are never altered.
- [x] Deletion: refuses (409) while labeling/learning jobs run; deletes learning
      job history (previously a foreign-key failure); notifies the AI service
      only after the local transaction commits and reports `aiNotified`.
- [x] New taxonomy keys limited to `[A-Za-z0-9_-]{1,50}`, `maxDepth` 1..5.
- [x] Restore route kept: it re-activates an inactive taxonomy (no UI uses it).
- [x] Tests: `lib/csv.test.ts`, `lib/taxonomy-csv.test.ts`,
      `tests/integration/import-export.test.ts` (7 cases).

Streaming export (later): `lib/export-csv.ts` pages records in import order
(keyset, 1,000 per page) and streams the CSV, so memory no longer grows with
the export. Taxonomy columns are ordered by key (before: by database row
order). The export is audited once the last row is sent. Integration test with
2,500 records over two imports.

## W07 Classiflow AI integration reliability

**Priority:** P1 when enabled, P2 otherwise. **Dependencies:** W04 storage, W05
counter semantics, W12 hosting topology. This is classiflow work only.

**Read:** [monitor](../../lib/ai-job-monitor.ts), [HTTP client](../../lib/ai-labeling.ts),
historical `lib/ai-job-queue.ts` and
`app/api/ai-labeling/external-training/start/route.ts`,
[active jobs](../../app/api/ai-jobs/active/route.ts),
[cancel](../../app/api/ai-jobs/[jobId]/cancel/route.ts), and [learning](../../app/api/ai-labeling/learn/route.ts).

**Evidence:** process-local monitor sets provide no cross-instance ownership.
Recovery relies on polling the active-jobs API and covers labeling/learning,
not every legacy job path. The shared queue processor is a placeholder, while
external training has its own processor. `storeLabelingResults` receives expected
sentence IDs but does not restrict returned IDs to them; result validation is
mostly casting. Completion updates can race cancellation during an awaited
external status request. These require lifecycle tests, not a new model service.

**Investigate and plan:**

- Describe one persistent job state machine, ownership/lease policy, bounded
  concurrency, retry/backoff, recovery trigger, and graceful shutdown.
- Test the crash window between external job acceptance and local external-ID
  persistence. Document any idempotency limitation of the existing external API;
  do not promise exactly-once execution without a supported contract.
- Ensure cancellation is a terminal conditional transition and result writes
  cannot resurrect it. Validate external payload schemas, allowed record IDs,
  taxonomy/level/code relationships, confidence bounds, and response size.
- Reconcile external-training/sync recovery with current monitors. Establish
  observable handling for pending jobs that no browser happens to poll.
- Start with the simplest durable approach supported by PostgreSQL and the
  current hosting; justify a separate worker or queue only if needed.

**Acceptance:** simulated restart, duplicate polling, two app instances, delayed
results, cancellation races, malformed results, and unavailable service have
defined outcomes. Unrelated records cannot be overwritten by a response. Human
labeling continues with the AI service absent. No Taxomind source changes needed.

**Status (21 Oct 2026): in progress.**

- [x] Result validation (`lib/ai-results.ts`, unit-tested): only the job's own
      record ids are written; levels 1..5 unique; codes non-empty strings
      (numbers stringified for compatibility); confidence clamped to 0..1;
      codes not in the taxonomy (other than the level's unknown) dropped.
      Rejections counted in `failedSentences` and logged.
- [x] Completion is a conditional transition (`updateMany` where status is
      pending/processing) in the same transaction as the stored suggestions, so
      a job cancelled while polling stays cancelled and gets no results.
      Failure is conditional too (`failIfActive`).
- [x] Monitor integration test against a stub HTTP service
      (`tests/integration/ai-job-monitor.test.ts`): payload and bearer token,
      completion with validated suggestions, service failure, cancel during
      polling, retry after failed status requests, lease respected, takeover
      of a dead instance's job without resending it, learning job.
- [x] Durable ownership: per-job database lease (migration `ai_job_lease`),
      claimed before start/poll, renewed per poll, cleared with the final
      status. A lost lease stops the monitor. Lease tests fail on the old code.
- [x] Recovery without polling: `instrumentation.ts` starts
      `startJobRecovery()` at server start (every 30 s, only with AI
      configured). Verified with the built server: a processing job with an
      expired lease was taken over on startup.
- [x] Retry/backoff: failed status requests double the poll interval up to
      5 minutes; the overall poll timeout still applies.
- [ ] Not verified against a running Taxomind (no service available here).
- [ ] Starting a job is not idempotent: if an instance dies after Taxomind
      accepted a job but before `externalJobId` was saved, the takeover sends it
      again (labeling sends `batchId: job.id`, so Taxomind could deduplicate).
- [ ] Graceful shutdown does not release leases; they expire within
      2 × poll interval + 60 s instead.

## W08 Query performance and metric correctness

**Priority:** P1 for incorrect metrics, P2 for measured optimization.
**Dependencies:** W01 visibility and W05 completion semantics must be shared.

**Read:** [queue API](../../app/api/sentences/route.ts),
[queue stats](../../app/api/sentences/stats/route.ts),
[progress stats](../../app/api/progress/stats/route.ts),
[team metrics](../../app/api/progress/team/route.ts),
[taxonomy nodes](../../app/api/taxonomies/[key]/nodes/route.ts),
[export](../../app/api/export/route.ts), [health](../../app/api/health/route.ts).

**Evidence:** progress agreement reads `SentenceAnnotation(source='ai')`, while
current monitors write `SentenceAISuggestion`. Matching uses sentence/level and
omits taxonomy ID. Team metrics issue many queries per member and load all their
assignments. Agreement uses repeated array searches. Legacy null `isLeaf` values
trigger a child-count query per returned node. Export builds all rows in memory.
Queue loads full comment bodies and lacks a unique tie-breaker in several sorts.
Health constructs a separate Prisma client and disconnects after each probe.

**Investigate and plan:**

- Define agreement precisely: latest suggestion versus suggestion shown when a
  person labeled. Decide whether a snapshot/history is required. Always match
  sentence, taxonomy, and level and preserve human-only completion counts.
- Establish synthetic datasets representative of record count, taxonomy size,
  team depth, comments, and active jobs. Measure query counts, p50/p95 latency,
  memory, response size, DB connections, and CPU; agree budgets before tuning.
- Use `EXPLAIN (ANALYZE, BUFFERS)` in an isolated database to evaluate index/query
  changes. Consider aggregated metrics, batched lookups, and appropriate search
  indexes; do not add speculative indexes to every column.
- Unify queue/stat filter construction and supervisor traversal (bounded/cycle-
  safe), add stable unique sorting, and evaluate cursor pagination where useful.
- Select only list fields needed by the UI. Cache taxonomy metadata only with
  clear invalidation; never share role-scoped response caches between users.
- Review direct server data access to avoid self-HTTP overhead only after W04's
  security/fallback contract is preserved. Use the shared Prisma client for probes.

**Acceptance:** metrics pass multi-taxonomy, repeated-edit, reassignment, and
date-boundary fixtures; queue/count/detail visibility agrees; performance changes
show before/after results at agreed sizes without stale data or scope leakage.

**Status (21 Oct 2026): correctness fixed; tuning open.**

- [x] AI agreement (progress stats and team) now compares human labels with
      `SentenceAISuggestion` on record + taxonomy + level (`lib/metrics.ts`,
      map lookup instead of repeated array scans). Previously it read legacy
      `SentenceAnnotation(source='ai')` rows that current monitors never write,
      so it was effectively always empty. Definition: current suggestion vs
      current label (no suggestion history). Integration test added.
- [x] Unknown-rate metric counts human labels only.
- [x] Queue, stats, detail, assignments and progress share one visibility rule
      (W01); progress date params validated.
- [x] New/replaced taxonomies get `isLeaf` at import (W06), removing the
      per-node child-count fallback for them.
- [x] Health probe uses the shared Prisma client, no per-probe disconnect, and
      no longer returns the error message.
- [ ] Team metrics still query per member; queue loads full comment bodies
      (the export now streams, W06). Needs representative data and agreed budgets
      before tuning (`EXPLAIN ANALYZE` on an isolated copy).

## W09 UI state and accessibility

**Priority:** P2. **Dependencies:** stable API contracts from W01/W05/W08.

**Read:** [queue client](../../app/queue/QueuePageClient.tsx),
[labeling page](../../app/queue/[sentenceId]/page.tsx),
[taxonomy browser](../../components/TaxonomyBrowser.tsx),
[assignment modal](../../components/queue/AssignmentModal.tsx),
[resize panel](../../components/ResizablePanel.tsx),
[toast](../../components/Toast.tsx), and [job badge](../../components/AIJobStatusBadge.tsx).

**Evidence:** queue requests do not cancel/ignore superseded responses, so a slow
old request can overwrite a newer filter result. Queue failures become empty
results; some stats failures retain stale values without an explicit indication.
Multiple independent polling loops exist. Individual labeling and taxonomy
administration exceed 1,000 lines each. Accessibility has not been browser-tested.

**Investigate and plan:**

- Use request identity/cancellation and coherent loading/error/stale states;
  debounce where useful, pause hidden-tab polling, and avoid overlapping requests.
- Decide on one fetch/cache pattern using existing dependencies only where it
  simplifies behavior; adopting React Query everywhere is not a goal by itself.
- Test selection across filters/pages, double submit, failed saves, navigation
  while saving, keyboard shortcuts in text fields, and incomplete ancestor lookup
  when a taxonomy level exceeds the current fetch limit.
- Audit keyboard-only dialogs, focus trap/restore, Escape, button names, live
  announcements, contrast, responsive layout, and keyboard resizing. Preserve
  the established theme and labeling shortcuts.
- Extract hooks/components around coherent behavior with integration coverage;
  file length is a signal to investigate, not sufficient reason to split a file.

**Acceptance:** delayed-response tests cannot show the wrong queue; users can
distinguish no results from failed loading; failed submissions remain recoverable;
critical import/assign/label/comment/export journeys work by keyboard and at
narrow viewport sizes. Validate through actual browser journeys.

**Status (21 Oct 2026): queue and dialogs done; larger UI items open.**

- [x] Queue requests: each new queue/stats request aborts the previous one and
      only the latest may set state (`lib/latest-request.ts`, unit-tested).
      Browser test: a slow superseded search cannot overwrite the newer result
      (fails with the guard disabled).
- [x] Search is debounced (300 ms): one request per pause, not per keystroke.
- [x] A failed queue load shows an alert with Retry and keeps the last results,
      instead of an empty "no sentences found" list. Browser-tested.
- [x] The 30 s stats refresh pauses while the tab is hidden and runs on return.
- [x] Dialogs (`components/Modal.tsx`): `role="dialog"`, accessible name,
      focus moved in, Tab trapped, Escape closes, focus restored. Used by all
      nine modals and the bulk-label panel. Browser-tested on the assignment
      dialog.
- [x] Labelling keyboard: taxonomy nodes are focusable buttons (Enter/Space,
      `aria-pressed`); Enter on a focused control no longer also submits the
      record; shortcuts are ignored inside dialogs. Browser-tested.
- [x] Names for icon-only buttons, search fields and row checkboxes; toasts
      announced through a polite live region.
- [x] A failed stats refresh keeps the last numbers and says they may be out
      of date (browser-tested with the queue failure journey).
- [ ] The AI job badge polls on its own interval.
- [ ] Not yet checked: contrast, narrow viewports, keyboard resizing of
      panels, failed-save recovery on the labelling page (still `alert()`).
- [ ] Splitting the 1,000-line labelling and taxonomy admin components.

## W10 Maintainability, tests, and CI

**Priority:** P1 for regression tests protecting security/data boundaries; P2 for
broad cleanup. **Dependencies:** run alongside each relevant workstream.

**Read:** [test config](../../vitest.config.ts), [CI](../../.github/workflows/ci.yml),
[Next config](../../next.config.ts), [lint config](../../eslint.config.mjs),
[utilities tests](../../lib/utils.test.ts), [AI field tests](../../lib/ai-utils.test.ts),
and the handlers/components being changed.

**Evidence:** seven tests cover two utilities. Lint reports 98 explicit-any
violations, 26 unused-variable warnings, six hook dependency warnings, four JSX
entity errors, and two require-import errors. Next build skips type/lint errors;
CI blocks on types/tests but only reports lint. Local types passing is useful but
does not validate authorization, transactions, or UI behavior.

**Investigate and plan:**

- Add integration fixtures using a disposable PostgreSQL database for access
  control, multi-taxonomy completion, concurrency, import validation, and deletion.
  Add a small browser suite for critical journeys, including AI unconfigured.
- Consolidate high-risk duplicated behavior first: scope policy, filters,
  annotation validation/status, CSV parsing, date ranges, and error contracts.
  Prefer small domain modules to a general service-layer rewrite.
- Inventory duplicate local types, `ok`/`success`/bare response contracts, old
  queue helpers, bootstrap/recovery scripts, and compatibility catches. Confirm
  callers/operational use before removal. Check apparently unused dependencies
  (`zustand`, React Query, `next-themes`, etc.) before deleting them.
- Replace `any` at API/database boundaries with validated data and Prisma types;
  fix hook dependency issues by checking behavior, not suppressing the rule.
- Introduce a no-new-lint-debt gate, then make full lint blocking after cleanup.
  Keep types/tests enforced in all deployment paths; plan removal of silent
  build bypasses once the container build can run the required checks reliably.
- Keep dead-code cleanup, dependency changes, and behavior changes in separate
  reviewable PRs. Preserve CSV code strings, singleton Prisma access, and auth.

**Acceptance:** tests fail on the reproduced W01/W05 regressions before fixes and
pass after; fresh and upgrade migrations are checked; no broad lint suppression
masks behavior; production releases cannot bypass the chosen checks; abstractions
remove demonstrated duplication while keeping route behavior explicit.

**Status (21 Oct 2026): browser journeys added; consolidation open.**

- [x] Integration harness against PostgreSQL (access, labelling, import/export,
      runtime DB role, AI monitor with a stub service): 51 tests, CI `integration`.
- [x] Browser journeys with Playwright (`tests/e2e`, CI `e2e`, gates
      `deploy-prod`): sign-in, queue search debounce/race/error, dialog
      keyboard behaviour, keyboard labelling and submit, export with leading
      zeros.
- [x] Lint is zero and blocking; one `any` remains in app code; no
      `eslint-disable` comments.
- [ ] Queue and stats build the same filter parameters in two places
      (`QueuePageClient.tsx`); the route handlers parse them separately too.
- [ ] `next.config.ts` still skips type and lint errors in `next build`; CI is
      the gate. Remove the bypass once nobody deploys without CI.
- [ ] More journeys: imports, taxonomy admin, team management, comments.

## W11 Documentation and agent navigation

**Priority:** P1 for unsafe/inaccurate instructions, P2 for overall restructuring.
**Dependencies:** update final runtime, deployment, and auth guidance after their
workstreams decide behavior; correct existing false instructions immediately.

**Read:** [README](../../README.md), [AGENTS](../../AGENTS.md),
[development](../../DEVELOPMENT.md), [environment](../../ENV_SETUP.md),
[deployment](../../DEPLOYMENT.md), [Coolify](../../COOLIFY_DEPLOYMENT.md),
[env template](../../.env.example), and the scripts they describe.

**Confirmed inaccuracies / duplication:**

- DEPLOYMENT and COOLIFY say changing the bootstrap password and restarting
  resets an existing admin; `init-admin.js` explicitly leaves existing users alone.
- DEVELOPMENT tells users to copy `.env` and run the plain Node admin script,
  but that script does not load `.env`. Document explicit environment loading.
- COOLIFY describes a username derived from email, `npm ci` with a fallback, and
  `pnpm lint`; actual code uses `admin` fallback and unlocked npm installation.
- COOLIFY's local-testing recipe includes volume deletion and global Docker
  pruning. Those are destructive operations, not routine setup prerequisites.
- ENV_SETUP, README, Compose, and `.env.example` differ on auth flags, URLs,
  defaults, and optional AI configuration. Placeholder AI values can make a
  supposedly human-only setup look configured.
- The generic PostgreSQL 12+ statement needs alignment with the supported,
  tested deployment matrix. The Next config references a missing
  `PUBLISHING_CHECKLIST.md`. Multi-replica advice omits job ownership limitations.
- README claims double annotation and sign-offs without explaining the actual
  replacement/status semantics; verify and qualify those product claims.

**Proposed canonical map:**

| Document | Sole responsibility |
| --- | --- |
| `README.md` | Product scope, short quick start, documentation links |
| `AGENTS.md` | Short routing map, invariants, commands, collaboration/release rules |
| `DEVELOPMENT.md` | One tested local setup, development/reset troubleshooting |
| `ENV_SETUP.md` | One variable reference: required/optional, dev/prod, secrecy, default |
| `DEPLOYMENT.md` | Platform-independent runtime, migrations, backups, release/rollback |
| `COOLIFY_DEPLOYMENT.md` | Only Coolify-specific configuration, links to common operations |
| `docs/architecture.md` (proposed) | Domain model, data flows, policy decisions, AI boundary |
| `docs/security.md` (proposed) | Threat model, access matrix, deployment assumptions, verification |
| `docs/plans/` | Active bounded implementation plans, linked only when relevant |

**Investigate and plan:** shorten AGENTS by moving explanatory detail to linked
architecture/domain sections while keeping critical invariants locally visible.
Keep one authoritative copy of each command/configuration rule. Use relative
Markdown links, a task-to-document map, and tested snippets. Archive superseded
plans separately from current operational guidance. Do not ask every agent to
read the entire documentation tree.

**Acceptance:** a new developer completes the human-only setup with the docs;
operators can distinguish bootstrap from recovery and data-preserving from
destructive commands; links resolve; environment variables match code/Compose;
an agent can find the relevant security/domain/deployment rule from one index.

**Status (21 Oct 2026): done.** `docs/architecture.md` was not created: AGENTS.md
already carries the architecture and domain rules, and a second copy would drift.

- [x] Canonical map in README ("Documentation") and AGENTS.md; ENV_SETUP.md is
      now the one variable reference (required/optional, defaults in code vs
      Compose, secrecy); README, DEPLOYMENT and DEVELOPMENT link to it instead of
      repeating lists.
- [x] `.env.example` matches the code: AI variables commented out (human-only by
      default), dev `DATABASE_URL`, Compose `POSTGRES_*`, no admin password
      placeholder. The old `ChangeMe123!` was refused in production mode, so the
      README quick start could not boot.
- [x] `npm run db:init-admin` loads `.env` (`--env-file-if-exists`); verified.
- [x] COOLIFY: destructive local-testing recipe (`down -v`, global prunes)
      removed; fragile line-number references replaced; npm/username claims
      were fixed earlier; smoke description and production recommendations
      updated.
- [x] PostgreSQL 16 stated as the tested version; multi-instance notes
      (AI leases, per-instance login throttle, connections) in DEPLOYMENT.md.
- [x] Admin bootstrap/reset docs (fixed with W02); README's double-annotation
      claim already points at docs/ideas.md; next.config.ts no longer references
      `PUBLISHING_CHECKLIST.md`.

## W12 Deployment, recovery, and observability

**Priority:** P1. **Dependencies:** W02 secrets, W03 artifacts, W04 ingress, W07
replica topology. Live hosting controls remain unverified.

**Read:** [Compose](../../docker-compose.yml),
[development Compose](../../docker-compose.dev.yml),
[Dockerfile](../../Dockerfile), [CI](../../.github/workflows/ci.yml),
[health probe](../../app/api/health/route.ts),
[deployment guide](../../DEPLOYMENT.md), [Coolify guide](../../COOLIFY_DEPLOYMENT.md).

**Evidence:** production Compose supplies fallback DB/admin passwords and uses
the database bootstrap identity for the application and migrations. The dev DB
binds `5434:5432` without loopback restriction. Container non-root execution and
internal production ports are good foundations. Compose runs migrations on app
startup; the Dockerfile alone does not. The workflow verifies empty-DB startup,
then merely queues production deployment. Documentation suggests backups but
provides no evidence of scheduled encrypted off-host backup or successful restore.
`AuditLog` exists, but no application `auditLog` writes were found.

**Investigate and plan:**

- Inventory real ingress, TLS, admin access, secrets storage, firewall/DB
  exposure, proxy headers, environment isolation, and Coolify auto-deploy settings.
  Fail fast on production placeholder secrets and bind dev database access to
  loopback by default. Check direct access cannot bypass ingress controls.
- Separate migration/bootstrap and least-privileged runtime DB access. Plan
  resource limits, connection budgets, writable directories, capability dropping,
  and read-only filesystem compatibility without breaking runtime uploads.
- Agree recovery objectives: tolerated data loss and recovery time. Establish
  encrypted off-host backups, retention, monitored failures, and periodic restore
  drills. Include required runtime files or explicitly make them disposable.
- Test migrations from a representative older database, not just empty startup.
  Define migration rollout/locking, rollback compatibility, and post-deploy
  verification of exact version, database, login, and a protected user journey.
- Preserve `staging` integration and the `promote-main.mjs` release rule. Verify
  actual GitHub rulesets and production auto-deploy settings rather than assuming
  repository comments enforce them. Prevent a later untested commit being chosen
  by a deployment triggered for an earlier checked commit.
- Add structured/redacted request and job logs, correlation IDs, actionable
  alerts, minimal readiness/liveness responses, and an audit policy for roles,
  deletions, imports/exports, assignments, and annotation changes. Define retention
  and avoid logging record contents/passwords by default.

**Acceptance:** a documented restore succeeds in isolation within agreed
objectives; an upgrade works from a populated older schema; production defaults
fail safely; runtime DB privileges are demonstrated; deployment health identifies
the intended release; alerts detect a failed deploy/stuck job/failed backup; audit
events record actor, action, target, and time with appropriate access controls.

**Status (21 Oct 2026): code side partly done;** hosting items need the maintainer.

- [x] Production defaults fail safely: Compose requires `POSTGRES_PASSWORD` and
      `NEXTAUTH_SECRET` (`${VAR:?}`, no fallbacks); `.env.example` lists them.
      Upgrade path for databases initialised with the old fallback in
      DEPLOYMENT.md. The dev database binds to `127.0.0.1:5434` only.
- [x] Least-privilege runtime DB access (opt-in): with `APP_DB_USER` /
      `APP_DB_PASSWORD`, `scripts/start.sh` runs migrations as the owner, then
      `scripts/db-runtime-role.js` grants the app role row access only (default
      privileges cover future migrations) and the server runs as it.
      Demonstrated by `tests/integration/db-runtime-role.test.ts` (no DDL, no
      TRUNCATE, no migration history, non-superuser; fails without the revoke /
      default privileges), by the CI smoke job (checks the server's connections
      use that role), and by a local run of the start command (login and
      password change as the app role).
- [x] Health identifies the release: the image takes `SOURCE_COMMIT` and
      `/api/health` reports it as `release`; the smoke job checks it equals the
      built commit; `deploy-prod` waits until production reports the promoted
      commit when the repository variable `PROD_HEALTH_URL` is set.
- [x] Backup and restore procedure: custom-format dumps, `scripts/restore-drill.sh`
      restores into a throwaway PostgreSQL 16 container, prints latest migration,
      row counts and duration; fails on a damaged dump. Tested locally.
- [ ] Recovery objectives, off-host encrypted schedule, retention and backup
      alerts: maintainer decisions, then a first drill against a real dump.
- [ ] Upgrade test from a populated older schema (needs a production-like dump;
      the restore drill plus `start.sh` is the procedure).
- [x] Audit events (`lib/audit.ts`, migration `audit_log_actor_name_indexes`):
      user create/update (role and supervisor from/to, admin password reset)/
      delete and own password change; taxonomy create/update/delete/import/
      restore/AI sync; record imports and import deletion; assignments; bulk
      labels; exports; AI job start/cancel; refused access by role or record
      scope (W01). Actor name survives user deletion. Payloads hold ids and
      counts only. Admin view `/admin/audit` (`GET /api/audit`, admin only,
      prefix filter, cursor paging). Retention: prune with SQL (DEPLOYMENT.md
      "Audit log"). `tests/integration/audit.test.ts`.
- [ ] Individual label saves, comments and flags are not audited by design
      (their rows carry author and time); revisit if label history is needed.
- [ ] Structured logs with correlation IDs; alerts for a failed deploy or a
      stuck AI job.
- [x] App container drops all Linux capabilities and sets
      `no-new-privileges` (Compose; the CI smoke job runs it).
- [ ] Read-only root filesystem and memory/CPU limits: not verifiable in this
      sandbox (no network inside Docker builds); check that the Prisma CLI
      writes nothing at `migrate deploy`, then add `read_only` with a `/tmp`
      tmpfs and limits sized from production usage.
- [ ] Verify live: GitHub rulesets, Coolify auto-deploy settings, ingress (W04).
