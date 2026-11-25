# Open work

## Feature backlog

- [ ] **More bulk actions from a queue filter.** Extend cross-page selection
  to other queue actions, including bulk labels and double annotation.
- [ ] **Double-annotation workflows.** Decide which workflow to add next.
  Candidates are repeat rounds, private reviewer notes, configurable blind
  review, learning snapshots, recording whether a labeller saw other labels,
  and revalidation after taxonomy changes. If only managers should be able
  to change confirmed results, preserve participant confidentiality and
  historical exports when giving a part back as ordinary work.
- [ ] **Admin MFA and single sign-on.** Design enrollment, recovery,
  enforcement, and organization-managed sign-in.
- [ ] **Operations monitoring.** Choose a log and trace backend and assign
  ownership for alerts on elevated 5xx rates, stuck or failed AI jobs,
  failed mail, and failed backups.

## Engineering follow-ups

- [ ] **Queue and progress performance.** Repeat the mixed read/write
  benchmark on staging-like data. The November local run measured 354 ms
  p95 for searched queue counts and 889 ms for a supervisor's two-year
  overview, which exceeds the 750 ms query budget. Reduce repeated counts
  or processing of compared pairs where measurements justify it.
- [ ] **Reporting rules.** Decide how queue date filters should handle
  local days and whether a supervisor's historical figures should follow
  current assignments. Queue date filters and progress reports use UTC today.
- [ ] **Double-annotation UI.** Align the state labels across the queue,
  review and exports. Decide whether to group the remaining manager actions
  and history on the record screen.
- [ ] **Deployment hardening.** Size container CPU and memory from hosted
  usage. Evaluate deploying the image tested by CI by digest and tightening
  the image scan gate. Provision a dedicated migration role where the host
  currently uses the PostgreSQL superuser.
- [ ] **Test coverage.** Add focused checks for AI job history pagination,
  user lookup, rate-limit boundaries and concurrent admin bootstrap.
  Improve isolation between browser specs and replace known fixed waits.
- [ ] **Incremental UI cleanup.** Standardize remaining user-facing
  “record” terminology and migrate remaining data requests to the shared
  query helpers when touching those screens.

## Taxomind collaboration

- [ ] **Namespace authorization.** Scope tokens to their workspace namespaces,
  including start, status and cancel. Until then, teams with untrusted
  workspace admins use a token held by a platform admin or their own instance.
- [ ] **Idempotent starts.** Taxomind should return the existing job when classiflow
  retries a start with the same key. Classiflow already sends a stable labeling
  batch ID. Add the key for learning and taxonomy sync with the new contract.
- [ ] **Taxonomy lifecycle.** Support deleting a taxonomy and its model in Taxomind,
  then call that operation when a workspace deletes a taxonomy.

See the [Taxomind integration plan](archive/taxomind-isolation.md) for the
proposed API changes and verification cases.

## Staging and development

- [x] **Deployment setup.** The maintainer confirmed the staging and
  development setup is in place on 24 November 2026.
- [x] **Backup and recovery setup.** The maintainer confirmed this is in place
  on 24 November 2026. See the [backup and restore procedure](../DEPLOYMENT.md#backups).

Follow [GitHub Actions](https://github.com/rowsquared/classiflow/actions?query=branch%3Astaging)
for current CI status. Use the [Coolify release procedure](../COOLIFY_DEPLOYMENT.md#releases)
when preparing a production release.

## Completed plans

- **Send to AI.** Select every record matching a queue view, choose synced
  taxonomies, and preview which records will be sent. The app skips active
  jobs and double-annotation records, and skips existing suggestions by
  default. Confirm to queue the batches in AI jobs.

- **Distribute work.** Select all records matching a queue view and preview
  an even random split or a split that balances existing workloads. The
  preview shows each labeller's current and projected open assignments.
  Open work includes pending ordinary records and unfinished parts in active
  double-annotation rounds.

Modernization, workspace isolation, user management, the Users and Workspaces
redesign, the Progress dashboard, and double annotation v1 and v2 are implemented
on `staging`. The [October plans](archive/plans-2026-10/) and
[double-annotation plans](archive/double-annotation/) preserve their design
history. The [November review](archive/reviews/2026-11-15-pre-production-review.md)
records the review findings and subsequent fixes. This page tracks current work.
