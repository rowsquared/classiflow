# Independent double annotation: implementation plan

**Status:** v1 in progress on branch `feature/double-annotation` (backend
and first UI done; see the checklist). Section 0 is the simplified v1 contract and the
handover checklist; where it differs from sections 1-15, section 0 wins.

**Date:** 22 October 2026.

**Baseline:** `fad746a` and the working-tree code inspected during planning.
Recheck affected contracts before implementation: other October changes were
in progress when this plan was drafted.

**Interactive mockup:** open the [standalone preview](../mockups/double-annotation/index.html).
Its [editable source and usage notes](../mockups/double-annotation/README.md)
are stored alongside it. All interactions use illustrative data.

## 0. v1 implementation (handover)

### Simplified contract

The goal is a workflow supervisors can run without training: pick two
people, watch one badge, decide disagreements on the record screen.

- **Model** (`prisma/schema.prisma`, migration `20261023100000_double_annotation`):
  `DoubleRound` (one active per record) → two `DoubleTask`s (position 1/2,
  two different people, partial unique indexes) → `DoubleTaskLabel` (each
  person's path, immutable by trigger) and `DoubleOutcome` per required
  taxonomy (`waiting | agreed | disagreed | reviewed | accepted_single`,
  frozen `matched`/`comparedAt`, `sourceTaskId` = first answer).
  `SentenceAnnotation` stays the current result (first answer while waiting
  or disagreeing). `Sentence.status` is `submitted` only when every required
  taxonomy is confirmed. `LabelingActivity.kind` is `label | review`.
- **Rules:** `lib/double-annotation.ts` (pure), workflow in
  `lib/server/double-annotation.ts`, queue row summary in
  `lib/server/double-queue.ts`. Required taxonomies = active taxonomies when
  the round starts (pinned via the outcome rows).
- **Starting** (`POST /sentences/double-annotation`, preview with
  `dryRun`, commit with the previewed counts as `expect`, 409 if changed):
  per record `fresh` (both people label; old partial/legacy labels stay as a
  fallback result), `labelled` (complete labels by one known author become
  answer 1; the other chosen person adds answer 2), `already` (left alone),
  `needs_first` (left out: unlabelled but only one person chosen). The
  preview reports all four counts, so nothing is skipped silently.
- **Labelling:** a participant's save writes their own answer; answers are
  final (409 on change). Blind views: own labels only, no AI suggestions, no
  other people's comments, own part's status in queue tabs, label/AI filters
  skip such records. Skip only skips their part.
- **Review:** a non-participant admin, or a supervisor whose team contains
  both labellers, saves a path on the record screen = decision (`reviewed`,
  original comparison kept). Allowed once both answers exist.
- **Manager commands** (`POST /sentences/[id]/double-annotation`):
  `accept_single` (reason; refused while disagreeing or with an empty
  taxonomy), `stop` (back to ordinary work, history kept), `reassign`
  (only a part with no answers yet).
- **Bulk:** bulk label/skip refuse selections containing active rounds (409);
  flags and comments still work.
- **Export:** existing columns unchanged; appended `annotation_mode`,
  `annotation_status` (`unlabelled | partial | provisional | needs_review |
  confirmed`), `{key}_annotation_status` (`unlabelled | single | provisional |
  disagreed | agreed | reviewed | accepted_single`). `labels=confirmed` keeps
  confirmed records only; `format=details` streams one row per record,
  round, person and taxonomy. Header collisions → 409.
- **Learning:** unchanged code path: it selects `submitted` records, which
  for double annotation now means confirmed. The learning counter grows only
  when a path becomes confirmed.

**Deliberately deferred** (keep out of v1 to stay simple): reopening a
submitted answer (reviewer decides instead), repeat rounds, exposure
tracking, command receipts table (record lock + final answers make replays
safe), immutable learning snapshots/reservations, taxonomy-change
revalidation of open rounds, private notes visible to reviewers (blind
viewers simply see only their own comments), kappa.

### Checklist

- [x] Schema, migration (RLS, partial unique indexes, immutability trigger), `WORKSPACE_MODELS`
- [x] Pure rules (`lib/double-annotation.ts`)
- [x] Workflow service: start/plan, answer, compare, review, accept single, stop, reassign
- [x] Single save route routes through the workflow; bulk refuses double records
- [x] Blind reads: record GET, comments, queue rows/tabs/filters; manager `double` view on record GET
- [x] Queue `double` filter (`any | review | waiting | gap | done`) and `needsReview` stat
- [x] Export status columns, confirmed-only, details CSV
- [x] Integration tests `tests/integration/double-annotation.test.ts` (5 journeys) + export header test updated
- [x] UI: assignment dialog mode "Two independent labels" with preview counts (`components/queue/DoubleAnnotationPanel.tsx`)
- [x] UI: queue badge per row (`DoubleBadge`), `double` filter in URL and filter panel, "Needs review · N" shortcut
- [x] UI: record screen panel (`components/labeling/DoublePanel.tsx`): both answers, first difference marked, use an answer, choose another, accept single, stop
- [ ] UI: reassign a part from the record screen (API exists: `action: 'reassign'`)
- [x] UI: labeller notice "Independent labelling" + locked submitted taxonomies
- [x] UI: export page selector (all / confirmed) + details download
- [ ] Progress dashboard: small double section (needs review, waiting, confirmed, agreement % with n)
- [x] Unit tests for `lib/double-annotation.ts`
- [ ] e2e journey (`tests/e2e/double-annotation.spec.ts`) + axe for the assignment dialog's new mode and the record panel
- [ ] Manual check in the browser of all journeys (not yet done)
- [ ] Docs: AGENTS.md, docs/security.md access matrix, README feature line
- [ ] lint, format, build; benchmark queue filters at scale

## 1. Product contract

Double annotation is an optional quality check on selected records in an
existing workspace. A workspace can contain ordinary single annotation and
double annotation without duplicating imports or creating another project.

The essential distinction is **available labels versus confirmed labels**.
Two annotations are required to confirm a double-annotation result, not to
make the first annotation usable or exportable.

The agreed direction:

- Assign two different people before either starts, or add a second
  annotation after a record has already been labelled.
- Preserve each person's submission. Neither overwrites the other.
- Export the first available valid path provisionally while waiting for the
  second annotation, including while a disagreement awaits review.
- Automatically confirm matching answers. An eligible supervisor or admin
  resolves disagreements and selects the final result.
- Keep the normal export at one row per record using the existing taxonomy
  columns. Add explicit status metadata and a confirmed-only option.
- Keep assignment and review in the existing queue and record screen.

The detailed defaults below are recommendations for the first implementation,
not implemented behaviour or previously approved decisions in every detail.
Amend them here before implementation if product choices change.

### First-release scope

Exactly two independent annotators per round, covering the record's required
taxonomies. Compare and resolve each taxonomy separately. Include manual bulk
assignment, individual/bulk saves, review, provisional exports, progress and
confirmed-only AI learning.

Defer three-or-more annotators, majority voting, automatic overlap sampling,
load-balanced distribution, chance-adjusted statistics such as Cohen's kappa,
and configurable annotator pools by taxonomy. Keep room in the model for
later extension without exposing these controls in v1.

## 2. Current behaviour and affected boundaries

| Area | Current behaviour | Change needed |
| --- | --- | --- |
| Assignments | Several workspace memberships can share a record | Distinguish record access from independent annotation responsibility |
| Labels | `SentenceAnnotation` is unique by record, taxonomy and level | Store separate submissions and revisions alongside one effective result |
| Saves | Single/bulk saves replace a taxonomy's shared human path | Save the actor's submission and calculate the effective result transactionally |
| Completion | Shared human labels determine record completion | Separate personal completion, result availability and confirmation |
| Queue/detail | Shared labels, comments and AI suggestions are exposed | Return an own-task view or an authorised result/review view |
| Progress | Personal completed workload follows the record's shared status | Use the person's task; count workspace records once |
| Export | Streams shared human labels | Stream effective paths with per-taxonomy status |
| Learning | Selects submitted annotations, then reads their current paths at dispatch | Select confirmed revisions and retain the selected payload |
| Taxonomy changes | Orphan checks inspect shared labels and AI suggestions | Include independent/historical paths and revalidate current results |

Primary entry points:

- [Schema](../../prisma/schema.prisma),
  [workspace database scope](../../lib/workspace/db.ts),
  [record access](../../lib/access.ts), [security contract](../security.md).
- [Single save](../../app/api/workspaces/[workspaceId]/sentences/[sentenceId]/annotations/route.ts),
  [bulk save](../../app/api/workspaces/[workspaceId]/sentences/bulk-label/route.ts),
  [assignments](../../app/api/workspaces/[workspaceId]/sentences/assign/route.ts),
  [completion rules](../../lib/annotation-status.ts),
  [path validation](../../lib/label-path.ts).
- [Queue queries](../../lib/server/sentences.ts),
  [queue URL state](../../lib/queue-url.ts),
  [queue components](../../components/queue),
  [labelling components](../../components/labeling),
  [progress queries](../../lib/server/progress.ts).
- [Export](../../lib/export-csv.ts),
  [learning creation](../../app/api/workspaces/[workspaceId]/ai-labeling/learn/route.ts),
  [job dispatch](../../lib/ai-job-monitor.ts).

Inspect actual single and bulk save implementations together; do not rely on
older documentation about differences in their completion rules.

## 3. User journeys

### 3.1 Assign both people before labelling

1. Select records in the queue and open Manage assignments.
2. Choose **Require two independent annotations** and two different active
   members using searchable pickers.
3. Preview the affected records, existing assignments and any conflicts.
   Do not silently replace an existing pair or duplicate a task.
4. Each person receives the record in their own pending queue, using the
   existing text panel, taxonomy tabs and browser.
5. The first valid submitted path becomes provisional immediately. Either
   person can finish first; task position does not determine submission order.
6. Matching taxonomy paths become confirmed. Different paths need review.

### 3.2 Add another annotation later

1. Select already labelled records and choose **Add second annotation**.
2. Preview the retained first submission and choose another labeller.
3. Preserve current paths, authorship and timestamps as a baseline. A known
   author of the retained baseline cannot be the second annotator.
4. Starting double annotation changes the confirmation status to provisional
   without removing/changing the existing exported code values.
5. The second person sees a blank independent task, not the first answer.

Mixed selections must show counts for unlabelled, partly labelled, already
labelled, already double-assigned and incompatible records. The user may
exclude incompatible records explicitly before committing. The chosen set
commits atomically; no silent row skipping.

### 3.3 The second annotation never arrives

The first valid label remains exportable provisionally indefinitely. A
supervisor can reassign the unfinished task, keep waiting, or choose
**Accept single annotation** with a reason. This closes the second requirement
and confirms valid available paths as `single_accepted`; missing taxonomies
remain incomplete. Do not invent another submission or agreement.

When two answers already disagree, use review to select the result. Accept
single annotation must not bypass review or erase a recorded disagreement.

### 3.4 Review a disagreement

Open the record through Needs review. Keep its text and support fields
visible, with both paths side by side and the first differing level marked.
For each disputed taxonomy offer **Use first answer**, **Use second answer**,
or **Choose another label** using the existing taxonomy browser.

Save the decision with an optional note, then **Save and next**. Matching
taxonomies need no extra decision. Preserve both original answers: review
creates a result, not a replacement for another person's submission.

### 3.5 Ordinary single annotation

Keep the current collaborative workflow: a permitted save can replace the
effective single result, preserving a revision and actual author. Having two
ordinary assignees does not activate double annotation. Only the explicit
double-annotation action creates independent tasks.

## 4. State and result rules

### Per-taxonomy result states

| State | Path in the normal CSV | Confirmed? |
| --- | --- | --- |
| `unlabelled` | Empty | No |
| `single` | Latest accepted ordinary human path | Yes |
| `awaiting_second` | First available valid independent path | No |
| `disagreed` | Retained provisional path | No |
| `agreed` | Identical independent path | Yes |
| `reviewed` | Reviewer's chosen path | Yes |
| `single_accepted` | Explicitly accepted single path after closing the double requirement | Yes |
| `invalidated` | Empty until a valid current result is established | No |

Rules:

1. Compare complete normalised paths: identical string codes at identical
   levels and the same termination point. Shared ancestors alone do not
   constitute agreement. Reuse the existing validation/equality helpers.
2. Level-specific unknown values are valid terminal choices. Matching unknown
   paths agree; report their count separately from informative agreement.
3. Skip, escalation and a missing submission are not unknown labels and are
   not disagreements. They do not satisfy an annotation requirement.
4. Establish the provisional source under the record lock when the first
   valid path arrives for that taxonomy. When a second annotation is added
   later, the existing baseline is already that source.
5. Keep that source stable when another answer arrives. Never pick the
   disagreement winner by last editor, code ordering or a later race.
6. A reviewer can choose a third path, subject to normal hierarchy/leaf rules.
7. Explicit withdrawal or taxonomy invalidation removes a path from current
   use. A remaining valid answer can become provisional, with the transition
   recorded; otherwise current codes are blank. Preserve historical paths.

### Task and record completion

Maintain three distinct derived facts:

- **My task:** pending, submitted, skipped, escalated or cancelled. Completion
  requires my valid submitted paths for every required taxonomy.
- **Available result:** none, partial or all required taxonomies available.
- **Confirmation:** incomplete, awaiting second, needs review or confirmed.

Per-taxonomy states are authoritative. If one taxonomy disagrees and another
awaits a submission, Needs review takes summary precedence, but filters expose
both facts. Task counts reflect all required taxonomies, not one saved path.

Keep `Sentence.status` as a compatibility summary: `submitted` means all
required results are confirmed, otherwise `pending`, with explicit existing
record-level skipped/escalated handling. A labeller's skip/escalation changes
their task, not the other task or the availability of existing labels.
Managers can perform a separate record-level skip/escalation action.

Personal queue tabs and navigation use task state; manager views use record
and result state. Never infer personal completion or the existence of a
provisional label solely from `Sentence.status`.

### Reopening and repeat work

Lock submitted double-annotation paths. A supervisor/admin can reopen a task
with a reason. Preserve immutable submitted revisions and invalidate decisions
based on replaced revisions. Keep the last submitted path available
provisionally while replacement is pending, unless withdrawn/invalidated.

After a compared pair is reopened, require review to reconfirm the affected
taxonomy. Matching edits must not manufacture independent agreement. Freeze
the original comparison when both answers first exist; reviewer decisions and
later changes never rewrite that observation.

Record known exposure to the other answer. A new independent repeat round
requires suitable annotators without known exposure. The application cannot
guarantee people have not discussed records outside it.

## 5. Persistence design

Do not simply add a nullable annotator to the current label uniqueness
constraint. Completion, provisional selection and review need explicit
ownership. The following are logical entities; final Prisma names and SQL
constraints are a DA0 deliverable.

| Entity | Required facts/invariants |
| --- | --- |
| Annotation round | Record, single/double mode, sequence, active/closed, creator, revision, independence flags; at most one active round per record |
| Round taxonomy | Required taxonomy and structure revision used for validation; unique round/taxonomy; explicit retirement state |
| Annotation task | Round, position 1/2, nullable assignee membership, assignment history and state; one current attempt per position; different users in the two positions |
| Submission revision | Task, taxonomy, revision, actual author/provenance, timing, operation ID, immutable complete path and validity; unique task/taxonomy/revision |
| Comparison | Exact pair of submitted revision IDs, original match/difference, differing level, time and independence eligibility |
| Result revision | Record/taxonomy, immutable effective path, state, contributing submission IDs, reviewer/reason/time and previous revision; one current pointer |
| Command receipt | Workspace, actor, operation ID, canonical request hash and committed response for transactional retries |

Use normalised child label rows with string `nodeCode` and `level` for paths.
Validate ownership using composite keys. Assignee and actual author differ:
reassignment never changes historical authorship. Single annotation also
writes result/submission revisions, without forcing an independent task for
every ordinary access assignee.

Retain `SentenceAnnotation` as the **current effective result projection**,
including provisional paths, with its existing unique constraint. Immutable
result revisions are the source of truth. Update the projection, current
pointer and result metadata in the same transaction. Each consumer explicitly
chooses own submissions, effective results or confirmed results. A human
projection row alone never proves confirmation; `source` still means human
versus AI, not provisional versus agreed.

Also add:

- Per-taxonomy structure revision and workflow/task/result version checks.
- Comment audience/task ownership for private annotation notes.
- Accepted result revision/path snapshots on `AILearningJobInput`.
- Activity metadata distinguishing annotation saves and review saves.

Every new workspace-owned table needs non-null `workspaceId`, composite
foreign keys, RLS policies, runtime-role grants, and registration in
`WORKSPACE_MODELS` in `lib/workspace/db.ts`. Index assignee/pending tasks,
active rounds, workspace/taxonomy result states and revision lookups. Use SQL
partial unique indexes where needed. Enforce annotator distinctness and
pointer ownership under locks and suitable database constraints, not only UI.

Never cascade membership deletion into submissions. Preserve provenance with
stable references/snapshots; use suspension for departing members. Reject
destructive membership/account deletion where retained history cannot yet be
preserved safely. Record/import deletion may remove dependent data consistently
with existing retention; workspace archival keeps data read-only.

## 6. Assignment, authorisation and independence

Keep `SentenceAssignment` as record access. Tasks describe work owed. Creating
a task ensures its assignee has access; other access assignments do not count
as annotation slots.

The assignment dialog distinguishes access changes from task replacement.
Replacing an unfinished assignee cancels that attempt and creates a new one,
without copying unsent work. Replacing submitted work requires explicit
reopening/new-round handling. Removing access never silently cancels work,
reduces the required count, or confirms a provisional result.

| Action | Labeller | Supervisor | Workspace/platform admin |
| --- | --- | --- | --- |
| Independent save | Own assigned task | Own assigned task | Own assigned task |
| Read both answers | No | Authorised review; not own participating pair | Authorised review; not own participating pair |
| Start/manage double work | No | Visible records and permitted team members | Workspace records/members |
| Review disagreement | No | All relevant participants in team scope; no self-review | Workspace scope; no self-review |
| Accept single/reopen | No | Same management scope, with reason | Workspace scope, with reason |
| Export | No | Unchanged: no export permission | Admin only, as today |

Record visibility does not itself grant submission access. Apply
`sentenceVisibilityFilter()` / `denyUnlessSentencesVisible()` plus task/review
checks within `workspaceRoute()`. An admin/supervisor who annotates receives
the blind task view and cannot review their own pair. Administrative access
outside the task workflow is not a scientific guarantee of blinding.

Cross-team review is admin work. A supervisor must control all relevant
participants, not just one assignee. Legacy/null-author baselines require
admin review when team scope cannot be established. Suspended members keep
submitted work; unfinished tasks show a reassignment gap. Archived workspaces
reject workflow writes and preserve existing authorised read/export behaviour.

### Preventing answer exposure

The independent task DTO returns only the person's own submission and notes.
Hide the other path, provisional/final codes, review outcomes, AI suggestions
and other people's answer-bearing comments. Keep the task screen blind after
submission as well; review uses a separate authorised view.

Cover all response and inference paths:

- Queue/detail labels, code filters, sorting, snippets and last-editor hints.
- Shared/private/resolved comments, previews and hidden-comment counts.
- AI endpoints and embedded suggestion data.
- Server-rendered initial data and TanStack Query caches.

Participating users' label filters operate on their own submissions; reject
result/review filters that could reveal another answer. Review queries use
separate view/task identities in cache keys. Review data must never populate
a blind task view through a cached response.

For double records, new annotation notes are private to the task and its
reviewers. Preserve existing shared comments but withhold them from blind
views, with a short explanation. Normal admin CSV retains shared comments
only; details export may include private notes with audience metadata.

When a proposed second annotator already viewed human labels, AI suggestions
or shared comments, show known exposure in the preview. Choose another person
or mark the comparison legacy/exposed and exclude it from independent
agreement statistics. Historical browsing before tracking exists cannot be
reconstructed; preserve unknown provenance rather than assert independence.

## 7. Server contracts and write orchestration

Create `lib/server/annotations.ts` or a small focused module split for workflow
commands, with pure state/comparison helpers and shared zod contracts in
`lib/contracts/annotations.ts`. Adapt both current save routes to that service.
Do not maintain separate single/bulk business rules.

Proposed routes relative to `/api/workspaces/[workspaceId]`:

| Route | Responsibility |
| --- | --- |
| `POST /sentences/annotation-rounds/preview` | Baselines, assignment/provenance conflicts and affected counts |
| `POST /sentences/annotation-rounds` | Start simultaneous/later double work for the explicit selected set |
| `POST /sentences/[sentenceId]/annotations` | Actor-owned submission; retain ordinary single-save workflow |
| `POST /sentences/bulk-label` | Same rules for each selected record, all-or-nothing |
| `GET /sentences/[sentenceId]` | Explicit authorised task/result DTO |
| `GET /sentences/[sentenceId]/review` | Both paths, comparison and result for eligible reviewers |
| `POST /sentences/[sentenceId]/review` | Decisions against expected result/submission versions |
| `POST /sentences/[sentenceId]/annotation-workflow` | Typed replace, reopen, accept-single and repeat-round commands |

Preview returns affected versions and eligibility. Commit rechecks versions,
visibility, memberships and taxonomy revisions; stale previews fail with `409`
without partial changes. Repeated commands return their committed receipt.

Every write follows this order:

1. Authorise record/action/task ownership inside workspace scope.
2. Lock affected sentences in sorted ID order. Recheck assignment/permissions
   where concurrent changes matter.
3. Check expected round/task/result/taxonomy versions. Establish a consistent
   record/taxonomy lock order for saves and taxonomy replacement.
4. Validate full paths using existing string-code, hierarchy/leaf/unknown rules.
5. Write immutable submissions, comparisons and result revisions, then update
   pointers, effective projection, personal task state and record summary.
6. Write activity, audit metadata and receipt in that transaction. Rollback
   leaves none of these effects.
7. Return `myTask`, availability, confirmation and per-taxonomy statuses.
   Update callers alongside any response-envelope changes.

Require operation IDs for new workflow commands and upgrade current save
replay handling: an existing operation ID plus identical request returns the
old response, not a new revision or an overwrite of later work. A different
payload with the same ID fails with `409`. Optimistic versions reject stale
tabs. Existing activity deduplication alone is insufficient.

Bulk saves on double records write only the actor's task; a manager cannot
resolve disagreements through bulk labelling implicitly. Apply the same
ownership/audience rules to skip, flags and bulk comments. Keep existing
request limits as ceilings and benchmark practical revision-write batch sizes.

Audit round creation, replacement, submission/reopen, agreement, review,
single acceptance and invalidation with IDs, versions and transitions. Never
copy record text, private note bodies or whole label paths into server logs.

## 8. UI and URL state

### Queue

Keep assignee chips, with per-person submitted/pending markers for managers.
Add a compact summary:

| Display | Meaning |
| --- | --- |
| `0/2 labelled` | Neither complete task submitted |
| `1/2 labelled · Awaiting second` | One complete task submitted |
| `2/2 · Agreed` | Both complete; every required taxonomy agrees |
| `2/2 · Needs review` | Both complete; at least one taxonomy differs |
| `2/2 · Resolved` | All required results confirmed after review |

Show **Second labeller needed** separately for missing/inactive unfinished
assignees. Per-taxonomy details explain partial progress. Needs review can
appear before `2/2` when one taxonomy already has two different submissions.

Add URL-backed filters for double required, assignment gaps, awaiting another
annotation, needs review, agreed, resolved and accepted single. Managers get a
prominent Needs review shortcut with a count. Shared parsers in
`lib/queue-url.ts` drive server and client; rows and counts use identical
scoped predicates. Preserve browser back/forward and pagination.

### Assignment and record screens

Extend the current assignment modal with ordinary and independent actions,
two searchable Comboboxes and a preview. Do not interpret the current union
of assignees across a mixed batch as a common assignment set.

Annotators keep the current browser and submit/next flow, with a short
independence notice, private notes and clear submission locking. Their own
task completion controls navigation, even while another person has not begun.

Use the same record route for an explicit authorised review view. Show both
paths, differing levels, a custom decision browser, and Save and next through
the scoped review list. Skip cases another reviewer has already resolved.

Use TanStack Query, `fetchJson`, workspace/view-specific keys, nuqs and the
existing stale-data/error conventions. Invalidate queue, record, assignments,
progress and relevant learning/taxonomy summaries after writes. No new manual
polling loops. Use Radix controls, teal styling, labelled inputs, keyboard
navigation and non-colour status text. Add review/assignment dialogs to axe.

## 9. Export contract

### Normal CSV

One row per record, with existing `{taxonomyKey}_{level}` columns containing
the effective available path, including provisional paths. Preserve original
field/support names, AI columns, flags, escaping, formula safety and string
codes/leading zeros. Keep current normal-export unknown formatting (`UNKNOWN`).

Append metadata rather than replacing the existing record status:

- `annotation_mode`: single/double for the current workflow.
- `annotation_status`: `unlabelled`, `partial`, `awaiting_second`,
  `needs_review` or `confirmed` for the record summary.
- `{taxonomyKey}_annotation_status`: precise taxonomy state from section 4.

Example: the first ISCO path stays in `ISCO_1` through `ISCO_4` while its status
is `awaiting_second`. On disagreement, codes remain and status is `disagreed`.
Review changes the effective codes and status to `reviewed`. A different
taxonomy can still be provisional on the same record.

Offer one labelled selector:

- **All available labels**, default: retain the ability to export all records,
  including blank/partial rows, with explicit statuses.
- **Confirmed records only**: include records with confirmed valid paths for
  every required taxonomy, including ordinary single and accepted-single work.

Keep existing record-status filters separate. Preserve admin-only export.
Document additive headers and detect collisions involving generated metadata,
taxonomy keys and imported field names. Neither CSV becomes a round-trip
record-import format.

Keep bounded streaming and permission checks per page. Freeze headers at
export start. Read each record's codes and states from one consistent version
using a joined query or repeatable-read page transaction; a default transaction
alone does not ensure consistency across separate reads. This remains a live
paged export, not a workspace-wide point-in-time snapshot.

### Annotation details CSV

Separate admin download, with one row per record, round, task and taxonomy
for each task's latest submitted revision, including closed rounds. Include
record key, taxonomy, round/position, author ID/display name, provenance,
submission revision/time, `code_1` through `code_5`, original comparison,
independence eligibility, effective result state/revision and reviewer/time.

Keep null/legacy attribution explicit, cancelled/replaced attempts identifiable,
and exact unknown sentinel strings for analysis. If notes are exported, include
audience metadata. Full intermediate revision-history export is deferred, but
the database must already retain immutable history.

## 10. Progress and agreement metrics

Extend the current dashboard with a small double-annotation section.

| Metric | Definition |
| --- | --- |
| Double required | Unique records with an active double requirement |
| Assignment gaps | Such records missing an active person for an unfinished slot |
| Awaiting annotation | Such records with an unfinished task |
| Needs review | Unique records with a disputed/reopened required taxonomy |
| Agreed | All required taxonomy results agreed |
| Resolved | All required results confirmed after at least one review decision |
| Available | Valid effective paths exist for all required taxonomies |
| Confirmed | All required results confirmed |
| My completed | My submitted tasks, independent of another person's task |

These facts overlap: do not present them as mutually exclusive pie slices.
Double-work personal assigned/completed/remaining counts use tasks; ordinary
records retain documented assignment semantics. Unknown-author baselines do
not give an arbitrary user completion credit.

Agreement per taxonomy is matching eligible original pairs divided by all
eligible original pairs. Exclude incomplete, skipped, invalid, unknown-author
and known-exposed pairs. Identical valid unknown paths match, with their count
shown separately. Display numerator/denominator and a dash for no eligible
pairs. Supervisor decisions never turn original disagreement into agreement.

Freeze the first eligible comparison per round. Date it at comparison time in
the workspace reporting zone. Default record summaries to the current round;
retain older observations in details. Apply current record/team scopes and
prevent pair reporting from revealing outcomes to blind participants. Manager
views show agreement; labellers see their own workload/activity.

Continue `LabelingActivity` for successful human saves, including human review
saves, with an annotation/review kind. Automatic agreement/projection updates
create no additional human event. Preserve existing distinct-record activity
definitions and add review counts without counting review as another
independent submission. Do not invent historical activity during migration.

Keep grouped queries with a bounded query count, current date/time-zone
semantics and server-side member pickers. Benchmark shared assignments,
double tasks and review filters at realistic scale using the runtime role.

## 11. AI integration

Ordinary single results remain eligible under the documented completion
policy. Double results qualify only when agreed, reviewed or single-accepted.
Never send both annotators as duplicate examples or train from a provisional
projection merely because it has `source: user`.

Persist the selected accepted result revision and exact path on each learning
input. Dispatch reads that snapshot, not current shared annotations. Before
dispatch, exclude inputs whose confirmation was revoked or whose result was
withdrawn/invalidated; persist actual counts/reasons and cancel empty jobs.
Do not silently replace a selected version with a later confirmed revision.

Reserve selected result revisions transactionally so concurrent learning
starts cannot schedule the same revision twice. Pending/processing inputs
retain reservations; failed/cancelled/excluded inputs release them. Reuse job
admission and leases for execution; result selection adds its own invariant.

The learning threshold should reflect currently eligible changed confirmed
label rows, counted once per current record/taxonomy result. Preserve its
documented label-row unit. Query current confirmed revisions not yet
successfully learned, with indexes. If retaining
`newAnnotationsSinceLastLearning` as a cache, recompute it transactionally;
increments from each independent save or reset-on-start cannot be authoritative.
Failures do not consume eligibility. Retain successful input revision
references for retries, partial batches and later corrected results.

Already-dispatched Taxomind jobs cannot be assumed to unlearn a path when
double review is requested later. Keep trained-version provenance and permit
later confirmed corrections to be learned. Use the existing one-path-per-record
Taxomind payload and verify it with the contract-checking stub.

Hide AI suggestions in blind double tasks by default. Suggestions can still
be generated/stored independently for managers, but must not enter task DTOs
or count as human completion. Record known prior AI exposure; legacy exposure
may be unknown.

## 12. Migration, taxonomy lifecycle and rollout

### Existing data

1. Add tables/columns, constraints, policies/grants and indexes; never modify
   an applied migration.
2. Backfill existing human paths into single-result revisions/baselines,
   preserving code strings, timestamps, authorship and normal export values.
3. Preserve actual authors per path. Never infer authors from last editor or
   reconstruct overwritten answers. Mark missing/mixed-level authorship
   `legacy_unknown`/`legacy_mixed`; different taxonomy authors stay distinct.
4. Validate current paths. Retain invalid historical codes and report them in
   migration QA, but mark current results invalidated rather than confirmed.
5. Keep existing multiple assignments ordinary single work. Do not fabricate
   submitted tasks for every assignee.
6. Do not convert AI-only data to human results or fabricate activity/agreement.

Intact known-author baselines can provide the first submission for later
comparison, with independence provenance recorded. Unknown/mixed/exposed
baselines remain useful for provisional export and admin review but do not
qualify for independent agreement statistics. The preview offers legacy
comparison or a fresh pair. For a fresh pair, retain the old label as an
explicit provisional fallback until a new submission arrives, without counting
it as either new person's work.

### Taxonomy lifecycle

Pin the required taxonomy set to the round. Activating another taxonomy must
not silently add work to submitted tasks; preview affected records and apply
an explicit requirement update with version changes. Record confirmation and
confirmed-only export follow the recorded set. Provide a manager filter for
records whose requirements differ from the current active taxonomy set.

Archive/restore must explicitly retire/restore requirements where selected
and recalculate summaries. Learning still requires its taxonomy to be active.
Node/hierarchy changes require path revalidation, not only checks for deleted
codes. Preserve historical paths/comparisons, invalidate affected current
results and require new work/review. Do not reinterpret an old path under new
parents. Definition/label-only changes can preserve validity when hierarchy
and codes are unchanged.

Extend replacement/orphan previews to count independent and historical paths.
Intentional hard deletion follows the existing admin destructive workflow,
with explicit dependent-data counts and consistent cleanup; new foreign keys
must not accidentally block deletion or silently cascade away evidence.

### Deployment and rollback

Use additive schema/backfill steps and an explicit cutover. Old writers must
not run alongside new writers because they bypass submissions/confirmation.
Drain annotation writes and learning starts, backfill/verify, deploy the new
readers/writers, then expose double-annotation actions. Existing queued learning
inputs need accepted-path snapshots while writes are paused, or explicit
cancellation/recreation; no mutable-read fallback.

Rehearse on a restored database with the least-privilege runtime role. After
double data exists, reverting the old application is unsafe. Prefer disabling
new round creation while keeping new readers. A full rollback needs a
coordinated database restore and a policy for work since that restore point.

## 13. Delivery phases and acceptance gates

All tasks are pending. Keep changes scoped and preserve unrelated working-tree
work. This plan does not authorise production deployment or promotion to main.

### DA0 — finalise contracts

- [ ] Encode complete state/result decision tables, including mixed partial
      taxonomies, provisional fallback, reopening and record-status semantics.
- [ ] Finalise Prisma names, SQL invariants, retention, DTOs and export headers.
- [ ] Confirm or amend the recommended product defaults in section 15.
- [ ] Sketch assignment, badges and review with existing UI components.

**Gate:** every journey has one explicit effective path, confirmation state,
owner and permitted next action; no absent second label blocks export.

### DA1 — persistence and backfill

- [ ] Add rounds/tasks, submission/comparison/result revisions, receipts,
      private-note scope, activity kinds and learning snapshots.
- [ ] Add RLS/grants/model registration and ownership/uniqueness constraints.
- [ ] Implement and validate baseline migration/data-quality reporting.
- [ ] Provide single-workflow compatibility reads, without activating double UI.

**Gate:** existing valid codes/export values survive; new tables are isolated
under the runtime role; no authorship or activity is invented.

### DA2 — transactional commands and scoped reads

- [ ] Shared single/bulk save service, validation, replay and conflict handling.
- [ ] Simultaneous/later round creation, replacement, reopen and accept-single.
- [ ] Comparison/review and atomic effective projection/state updates.
- [ ] Own-task/review DTOs, private comments and inference protection.
- [ ] Transactional audit/activity with no automatic duplicate human events.

**Gate:** concurrent annotators retain both answers, conflicting reviewers get
a clear conflict, and blind participants cannot obtain/infer another path.

### DA3 — queue, labelling and review UI

- [ ] Two-person assignment preview and mixed-batch conflict handling.
- [ ] Task chips, badges, URL filters and Needs review shortcut/count.
- [ ] Personal completion/navigation, private notes and submission locks.
- [ ] Side-by-side review, custom path and Save and next.
- [ ] View-specific caching, invalidation and accessibility coverage.

**Gate:** demonstrate all section 3 journeys with two labellers and a reviewer,
without database edits or manual API calls.

### DA4 — export, reporting, learning and taxonomy lifecycle

- [ ] Effective-label CSV/statuses, confirmed-only selector and details CSV.
- [ ] Personal task progress, available/confirmed counts and frozen agreement.
- [ ] Accepted training snapshots, reservations and exact eligibility.
- [ ] Explicit taxonomy requirements and path revalidation/deletion handling.
- [ ] Query-count checks, runtime-role benchmarks and bounded streaming/bulk work.

**Gate:** provisional labels export, outstanding work stays identifiable,
disagreements resolve correctly, and learning receives one eligible confirmed
path per selected record/taxonomy.

### DA5 — release verification and documentation

- [ ] Run section 14 checks and migration/cutover rehearsal.
- [ ] Update AGENTS.md for implemented ownership/completion and docs/security.md
      for the actual access matrix; update product/development docs in their homes.
- [ ] Update ENV_SETUP only for actual new settings; prefer no feature-specific
      deployment setting.
- [ ] Record staging evidence/limitations and mark completed plan tasks.

**Gate:** ordinary single work and all double journeys pass on PostgreSQL with
production-style runtime permissions.

## 14. Verification matrix

| Layer | Required scenarios |
| --- | --- |
| Pure rules | Exact paths, leading zeros, each unknown depth, different terminal depths, missing versus disagreement, stable provisional source, mixed taxonomy states, stale review, original comparison unchanged by review |
| Database/migration | Active-round/task uniqueness, distinct people, same-workspace ownership, pointer integrity, legacy/invalid/AI-only data, multiple existing assignments, retention/deletion and idempotent backfill |
| Concurrency | Two annotators, second position finishes first, same person twice, stale tab, lost-response replay, operation ID with changed payload, reviewer races, reopen races, bulk rollback, assignment/taxonomy changes during saves |
| Access/privacy | Two workspaces, own/team/cross-team scopes, denied self-review, suspended/archived write races, label-filter inference, hidden/resolved comments and counts, AI endpoints, review cache never serving blind task data |
| Workflow | Both assigned up front, second added later, second never arrives, replacement, accept single, disagreement cannot be waived away, partial taxonomies, skip/escalation, invalidation, access-only assignees not counted as annotators |
| CSV | Provisional/agreed/reviewed/single-accepted paths, confirmed-only exclusion, mixed statuses, string/unknown/formula handling, header collisions, private notes, bounded streaming and mid-export permission revocation |
| Progress | Alice done while Bob pending, unique record totals, overlapping facts, eligible original pair numerator/denominator, unknown/legacy/exposed pairs, date/DST filters and bounded query count |
| AI | Provisional excluded, no duplicate examples/reservations, immutable selected payload, revoked queued input, failure releases eligibility, corrected result eligible again, no independent-save counter inflation, Taxomind contract |
| Browser/axe | Assignment/mixed selection, personal queue, locked submit, private notes, review/custom decision/next, URL history, stale conflict recovery, keyboard navigation and accessible dialogs |

Add integration coverage beside `labeling.test.ts`, `access-control.test.ts`,
`import-export.test.ts`, `progress-reports.test.ts` and `ai-job-monitor.test.ts`,
plus a dedicated double-annotation suite. Add
`tests/e2e/double-annotation.spec.ts` and extend the accessibility suite.

Implementation checks: relevant unit/integration suites, typecheck, lint,
scoped Prettier, production build and relevant Playwright journeys. Complete
CI-required checks before release and distinguish pre-existing failures.
This document-only task needs formatting/link checks, not application tests.

## 15. Recommended defaults

These make the plan concrete and remain changeable product choices.

| Decision | Recommendation |
| --- | --- |
| Scope | Selected records in one workspace; exactly two independent tasks |
| First answer | Immediately exportable provisionally, retained on disagreement |
| Ordinary single work | Confirmed after one valid human annotation, as today |
| Normal export | All available labels with appended per-taxonomy statuses |
| Second never arrives | Wait, reassign or explicitly accept single with a reason |
| Unresolved disagreement | Keep provisional path; review is required for confirmation |
| Independence | Hide other paths, AI suggestions and shared comments in task views |
| Self-review | Disallow; another eligible reviewer decides |
| Legacy/exposed pairs | Permit useful comparison; exclude from independent agreement statistics |
| Taxonomy requirements | Pin to round and explicitly apply later changes |
| Learning | Confirmed results only with immutable selected input revisions |
| Advanced statistics | Exact agreement with denominator first; defer kappa |

Success means a supervisor can add another labeller now or later, identify
staffing gaps and disagreements, and resolve them quickly while the first
person's work stays available in an ordinary usable CSV.
