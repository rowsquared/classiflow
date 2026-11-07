# Double annotation v2: review findings and improvement plan

**Status:** phases A-E implemented (7 November 2026, see section 6); what is
left is in the handover below. **Date:** 7 November 2026.
**Baseline:** `b87c3d6` on `staging` (v1 as described in
[double-annotation.md](double-annotation.md) section 0).

**Mockups:** [docs/mockups/double-annotation-v2/index.html](../mockups/double-annotation-v2/index.html)
(static page, open it in a browser; illustrative data).

## 0. How this was produced

- Read the v1 plan, the workflow (`lib/double-annotation.ts`,
  `lib/server/double-annotation.ts`, `lib/server/double-queue.ts`,
  `lib/server/record.ts`, the save route), the queue, record-screen and
  progress components and the export (`lib/export-csv.ts`, export page).
- Ran the app locally on the demo workspace (`scripts/seed-demo.ts`: 35
  records in every double-annotation state) and clicked through as the
  supervisor (demo.amina), a labeller (demo.sofia) and the admin
  (demo.grace): review queue, review panel, a review decision, the labeller's
  queue and record screen before and after review, the start dialog, both
  CSV exports and the progress figures.

v1 works for the happy path: starting a round, blind labelling while the
round is open, the "Needs review" shortcut, deciding on the record screen,
the details CSV. The problems start **after a round closes**, and the tools
around review and analysis are thin.

The non-negotiable rule from the product owner:

> A labeller must never be able to tell that a record was also labelled by
> someone else.

Section 1 lists where that rule is broken today. Section 2 turns the rule
into invariants the code can test.

## 1. Findings

Severity: **P0** breaks the confidentiality rule or produces wrong data,
**P1** makes the workflow slow or error-prone, **P2** polish.

### 1.1 Confidentiality and data integrity (P0)

| # | Finding | Evidence (local demo) | Cause |
| --- | --- | --- | --- |
| C1 | **After a round closes, the labeller sees the other person's answer.** Sofia answered ISCO `8321`; after the review chose `8322`, her record screen shows `8322` as if it were hers, and her queue row shows **Editor: Priya Nair** with Priya's code. | `demo_s_1_235` as demo.sofia: record screen and Submitted tab | `blindSentenceIds()` and `doubleViewFor()` only consider rounds with `status = 'active'`. A completed round falls back to the ordinary view (current result, `lastEditor`, every comment, AI suggestions). |
| C2 | **A labeller can overwrite a confirmed result after the round closed**, and the export still calls it reviewed. Sofia re-submitted `8321`; `SentenceAnnotation` now holds her path, `DoubleOutcome.state` is still `reviewed`, and the CSV row says `ISCO08_annotation_status = reviewed` with a code the reviewer rejected. | same record; export row `LFS26-Q1-00121-01` | The save route only routes through the workflow while a round is active. After completion the ordinary save replaces the result. The export derives status from the outcome, not from the path it exports. |
| C3 | **Submitted answers are read-only only on double records.** On an ordinary record a labeller can change a submitted label; on a double record the taxonomy browser is disabled and a save returns "You already submitted this taxonomy. Contact your supervisor". The difference itself tells the labeller something is special. | `recordLabelingAccess()` (`editableTaxonomies` = required minus answered) | Answers are immutable by design (v1 simplification). |
| C4 | **"Hidden" records.** A labeller who still has a plain assignment to a record in a round they do not label (assigned before the round, or whose part was handed over) sees it in the queue with no labels and cannot edit it, without explanation. After the round closes they see everything (C1). | `viewFor()` mode `hidden`; `reassignTask()` keeps the old person's `SentenceAssignment` | Starting a round and handing over a part do not remove other labellers' access. |
| C5 | **The flag is shared.** A flag set by the other labeller (or a manager) shows on the blind record. | record GET spreads `sentence.flagged` | One boolean on `Sentence`. |
| C6 | **Label filters behave differently.** A labeller who filters the queue by labels or codes loses all their open double records from the result (not only the other person's labels). | `notBlindFor()` for labellers excludes every active round | Over-broad exclusion. |
| C7 | **Stopping a round** turns the record into ordinary work; if both participants are still assigned, each now sees the other's labels and comments. | `stopRound()` | Same cause as C1. |

### 1.2 Supervisor and admin workflow (P1)

| # | Finding |
| --- | --- |
| S1 | Taxonomy tabs on a review record show "ISCO08 ✓ ISIC4 ✓, 2/2 taxonomies completed" although ISCO needs review. The tab does not say which taxonomy is disputed. |
| S2 | The taxonomy browser under the panel is **pre-filled with the first answer** and **Submit** saves it as a decision. Pressing Enter on a review record confirms person A without a conscious choice. The same Submit is live on *agreed* taxonomies and silently overrides an agreement. |
| S3 | "Use this answer" decides in one click and jumps to the next record, with no confirmation, no undo and no way to add the note. The API accepts `reviewNote`; the UI never sends it, so `review_note` is always empty. |
| S4 | The two answers are two lists; the reviewer reads level by level across both. No code definitions, no AI suggestion as a third opinion, no hint which answer is the "current result" except the jargon "(existing labels) · current result". |
| S5 | Once a round is complete the panel disappears. Nobody can see on the record who answered what, who decided, or why; only the details CSV knows. |
| S6 | In the queue the state is a badge squeezed under the assignee chips ("1/2 labelled", "Needs review"). The Labels column shows only the provisional answer, so in the review list you cannot see what the disagreement is without opening each record. The counter "0 of 8 labelled" on a list of labelled records confuses. |
| S7 | Start dialog: "First person"/"Second person" plus the rule "(or the other person, if X labelled one)" is hard to follow. No automatic second person, no sampling ("double-code 10 % of this import"), no per-person workload in the preview, records with mixed authors silently become "fresh" (both relabel). |
| S8 | No bulk manager actions: accept single, hand over, stop for a selection (e.g. a labeller left with 200 open parts). |
| S9 | Handing over a part overwrites `DoubleTask.assigneeId`; who held it before is lost (and keeps access, C4). |
| S10 | Progress shows full-path agreement only (demo: ISCO 5/15 = 33 %). For ISCO and ISIC the useful figure is agreement **per level** (1-digit, 2-digit, ...), per labeller and the most frequent confusions. Supervisors cannot export, so this must be in the app. |

### 1.3 Export (P1)

| # | Finding |
| --- | --- |
| E1 | The main export always carries `annotation_mode`, `annotation_status` and `{key}_annotation_status`, even in workspaces that never used double annotation. Fine for analysis, noise for the "clean" file. |
| E2 | The details CSV is long format (record × round × person × taxonomy): four rows per record for two taxonomies. To compare answers you must pivot it. It has no record text, no node labels, no per-level match, no final result codes, no AI suggestion, and identifies people only by display name (not unique). |
| E3 | `answered_at` for baseline answers is the round start, not when the labels were made; `labelingStartedAt` (time spent) is stored but not exported. |
| E4 | Unknown codes export as `UNKNOWN` in the main file and as `-9`/`-99`... in the details file, undocumented. |
| E5 | No agreement summary or confusion list as a file; the admin has to compute them. |
| E6 | The export page downloads through `fetch().blob()` (whole file in browser memory, defeating the server streaming), shows no counts before download, and its "Status filter" is record status, which means little for the details file. |

### 1.4 Code (P1/P2)

| # | Finding |
| --- | --- |
| K1 | The confirmed result exists only as `SentenceAnnotation` rows, which any later save can replace (C2). There is no snapshot of the decided path per outcome, so older rounds cannot report their final codes and drift cannot be detected. |
| K2 | `DoubleTaskLabel` is immutable with no revision number, which forces the read-only behaviour (C3). |
| K3 | Agreement is a single boolean (`matched`); per-level agreement must be recomputed from paths for every report. Freezing `agreedDepth` (number of leading levels equal) at comparison time makes per-level statistics one indexed query. |
| K4 | Participation logic is spread over `viewFor`, `blindSentenceIds`, `notBlindFor`, `commentAudienceFilter`, `ownAnswers` and the record/queue code, each with its own "active round" predicate. C1, C6 and C7 are three symptoms of that. One function should decide "does this person see this record as a participant". |
| K5 | `reviewTaxonomy()` accepts decisions on `agreed` outcomes (silent override, S2); it should require an explicit "override" intent. |
| K6 | The dev server logs `pg` "client.query() when the client is already executing a query" deprecation warnings on the review screen; some read runs concurrent queries outside the per-transaction queue. Not double-specific, but should be found before pg 9. |
| K7 | Integration tests cover the open round only; none checks the participant view or saves after completion, after stop or after hand-over. |

## 2. Labeller invariants (the confidentiality rule, made testable)

1. **Sticky participation.** Once a person holds a part in a round of a
   record, that record is *theirs* for good: they see their own answer, their
   own comments, their own flag, their own edit time, and nothing else, also
   after the round completes, is stopped, or the part is handed over. Only an
   explicit, logged manager action ("give back as ordinary work") ends it.
2. **Same behaviour as ordinary work.** Everything a labeller can do on an
   ordinary submitted record they can do on a double record (change their
   submitted label, flag, comment, skip), with the same messages. A change
   only ever writes *their* answer (a new revision), never the result.
3. **No side channels.** Status tabs, counts, filters, sort orders, editor
   and edit-time columns, comment counts, flags, AI suggestions and the
   response shape of the record API are computed from the person's own part.
   No double-specific message or error text ever reaches a labeller.
4. **No hidden records.** A labeller either has a part (sees own answer) or
   does not see the record at all. Starting a round and handing over a part
   remove other labellers' plain assignments to that record (the preview says
   how many).
5. **Supervisors and admins who label** a record are participants for that
   record (as today) and get rules 1-3 for it; they review only records they
   did not label.

Each rule gets an integration test (section 6, phase A).

## 3. Supervisor and admin experience

Mockups: sections "Review", "Queue", "Start", "Record history" of the
mockup page.

### 3.1 Review mode (fixes S1-S4)

- **Entry:** "Needs review · 8" opens the first record in review mode, with
  the list as navigation ("Review 3 of 8").
- **Tabs carry state:** "ISCO08 · Needs review", "ISIC4 · Agreed",
  "ISIC4 · Waiting". The ✓ counter is replaced by "1 of 2 taxonomies to
  decide".
- **Comparison table** instead of two lists: one row per level, columns
  *Answer A*, *Answer B*, rows from the first difference marked, node
  definitions on hover. Optional third column *AI suggestion* (managers only,
  hidden by default, per-browser toggle).
- **Explicit decision:** three choices, *Use A* (key `1`), *Use B* (`2`),
  *Other label* (`3`, opens the taxonomy browser **empty**). An optional
  note field. Primary button "Save decision and next" (Enter). Nothing is
  pre-selected; Enter without a choice does nothing.
- **Feedback:** a toast "ISCO08 decided: Answer B · Undo" (undo within the
  toast's lifetime re-opens the outcome).
- **Agreed taxonomies** show the agreed path read-only with a quiet
  "Override…" link (asks for a reason, recorded as reviewed with override).
- **Blind review (option):** workspace setting to show "Answer A / Answer B"
  without names, to reduce reviewer bias; names appear after deciding.

### 3.2 Queue (fixes S6, S8)

- A dedicated **Double** column for managers (state in words, `1/2` while
  waiting, red "Needs another person"), instead of badges under the
  assignee chips. Hidden when the workspace has no rounds.
- In the **Needs review** view the Labels column shows the disputed taxonomy
  as `A 2221 · B 2222` (first differing level emphasised), so a reviewer can
  triage without opening records.
- Filter chips at the top of the double view: *Waiting · Needs review ·
  Needs another person · Confirmed*, with counts.
- Bulk manager actions on a selection: *Accept single label…*, *Hand over
  parts…* (from person X to Y), *Stop double annotation…*, each with a
  preview count and a reason.
- The counter reads "8 records · 0 confirmed" in double views instead of
  "0 of 8 labeled".

### 3.3 Starting double annotation (fixes S7)

- Two modes as cards: **Both label from scratch** (two people) and **Add a
  second label to labelled records** (one person; existing labels are the
  first answer).
- **Second person:** a specific person, or **Automatic: balanced across my
  team** (never the author of the first answer, fewest open parts first).
- **Sampling:** "Double-code all selected records" or "a random 10 %"
  (number input), so supervisors can run continuous quality control on a
  share of each import.
- **Preview table:** per person, how many new parts they get; how many
  records keep existing labels as the first answer; how many have labels by
  several people (and what happens to them); how many other labellers lose
  access (invariant 4); records already in a round.

### 3.4 Record history (fixes S5, S9)

- After a round completes, managers see a read-only **Double annotation
  history** panel: both answers, original comparison (agreed at level n),
  decision, reviewer, note, dates, hand-overs.
- **Change confirmed result…** replaces the ordinary edit on such records
  for managers: it records a new review decision (reason required), so the
  export status always matches the exported path.
- Hand-over cancels the old task and creates a new one in the same position
  (the partial unique indexes already allow this), so history keeps who held
  the part.

### 3.5 Progress: agreement that helps (fixes S10)

- **Agreement by level** per taxonomy: share of compared pairs that agree at
  level 1, 2, 3, ... (from the frozen `agreedDepth`), with numerator and
  denominator, plus full-path agreement.
- **By labeller:** pairs compared, agreement with partner, and how often the
  reviewer chose this person's answer. Shown to supervisors and admins only.
- **Most frequent disagreements:** top code pairs (`2221 ↔ 2222`, count),
  each linking to the queue filtered to those records.
- **Waiting age:** open parts older than 3/7/14 days per person.
- Kappa (added 8 November 2026): Fleiss' kappa per taxonomy and level and
  for the full path, next to the percentages. Fleiss rather than Cohen
  because each record's pair is two different people, not the same two
  raters throughout; the chance term uses the codes of all answers pooled.
  The category at level L is the path up to L, so kappa and the percentage
  agree on what counts as agreement (`KappaTally`/`LevelKappa` in
  `lib/double-annotation.ts`). The agreement file has a `kappa` column for
  level and pair rows.

## 4. Export: one clean file, one analysis pack

Mockup: section "Export".

### 4.1 Records export (the clean file)

- Unchanged default columns for ordinary work.
- The three status columns become an option "Include annotation status
  columns", **on by default only when the workspace has double-annotation
  rounds**. With it off, the file is exactly the pre-v1 layout.
- "Confirmed records only" stays; its help text names the cases
  (ordinary complete, agreed, reviewed, single accepted).
- Unknown codes: keep `UNKNOWN`, document it next to the option.

### 4.2 Double annotation analysis (new, separate download)

One download, choice of three files (or all three as a ZIP):

**a) Pairs (one row per record, round and taxonomy), the main analysis file**

| Column | Content |
| --- | --- |
| `id` | record key |
| `field_*`, `support_*` | optional ("Include record text"), default on |
| `taxonomy`, `round`, `round_status`, `round_started`, `round_closed`, `close_reason` | |
| `a_labeller`, `a_username`, `a_from_existing_labels`, `a_answered_at`, `a_seconds` | person A (position 1); `a_seconds` from `labelingStartedAt` |
| `a_code_1` ... `a_code_n`, `a_label` | A's path (raw codes incl. `-9`...), deepest node label |
| `b_*` | same for B |
| `match_1` ... `match_n` | `true/false/` per level (empty when a level is missing on both sides) |
| `agreed_depth`, `first_diff_level`, `original_match` | frozen at comparison |
| `final_code_1` ... `final_code_n`, `final_label`, `final_source` | decided path; source `agreed`, `a`, `b`, `other`, `single_a`, `single_b` |
| `result_status`, `reviewed_by`, `reviewed_at`, `review_note`, `revised_after_compare` | |
| `ai_code`, `ai_confidence` | current AI suggestion at the deepest level, optional |

**b) Answers (long format)**: today's details file, extended with
`username`, `seconds`, `revision`, and with the real `answered_at` for
baseline answers. For people who prefer long data or more than one revision.

**c) Agreement summary**: one row per taxonomy × level
(`compared`, `agreed`, `share`), per labeller pair, and a confusion list
(`taxonomy, level, code_a, code_b, count`) for the selected period.

Filters on this card are double-specific: round status (open / completed /
stopped / all), compared between (dates), import, taxonomy. The page shows
the number of rounds and pairs before download.

All three stream like today (pages of 1000 records, re-authorised per page)
and go through `lib/csv.ts`. The page downloads with a plain link (`<a
href download>`) so the browser streams to disk instead of buffering a blob.

Supervisors download the analysis files (not the records export) for their
team: the records they can see, without records they labelled themselves
(decided 8 November 2026; `analysisScope()` in `lib/export-double.ts`). A
round with one labeller outside the team shows up when the record is visible
to the supervisor, as it does on the record screen.

## 5. Data model and code changes

| Change | Why |
| --- | --- |
| `DoubleTaskLabel.revision Int` (part of the key), immutable rows, current answer = highest revision | Labellers can change their answer like ordinary work (C3); the original comparison stays frozen |
| `DoubleTask.flagged Boolean` | Per-participant flag (C5); managers see "flagged by Sofia" |
| `DoubleOutcome.agreedDepth Int?`, `firstDiffLevel Int?` frozen at comparison | Per-level statistics (K3, 3.5, 4.2) |
| `DoubleOutcome.resultSource` (`first, second, other, single`) and `DoubleResultLabel(roundId, taxonomyId, level, nodeCode)` | Snapshot of the confirmed path; drift detection; final codes for older rounds (K1, C2) |
| `DoubleOutcome.revisedAfterCompare Boolean` | Managers see when a labeller changed an answer after the comparison; statistics still use the frozen comparison |
| `lib/server/double-participation.ts`: one `participation(user, sentenceIds)` used by record GET, queue rows, tabs, filters, comments, AI reads and saves | Single source for invariants 1-5 (K4) |
| Save route: a participant's save always goes to `saveTaskAnswer` (any round status); a manager's save on a confirmed outcome requires `override: true` + reason | C1, C2, K5 |
| Export status computed against `DoubleResultLabel`, not only the outcome state | Status can never contradict the codes |
| `startRounds` / `reassignTask` remove other labellers' plain assignments; hand-over = cancel + new task | C4, S9 |
| Queue/record "who edited last" for managers stays the record's; for participants, their own revision time | C1 |

Revision rules (C3, invariant 2):

- Before the other answer exists: a new revision simply replaces the
  answer (it is still the first answer and the provisional result).
- After comparison, round still open: the new revision is stored; the
  frozen comparison is unchanged; `revisedAfterCompare = true`; if the
  outcome was *agreed* and the new answer differs, the outcome becomes
  *disagreed* (needs review). Nothing is shown to the labeller.
- After the round completed: the revision is stored and flagged to
  managers; the confirmed result does not change unless a manager decides.

Migration: additive columns with defaults; backfill `revision = 1`,
`agreedDepth`/`firstDiffLevel` from existing pairs, `DoubleResultLabel` from
`SentenceAnnotation` for completed rounds (and record drift found for rounds
like C2 in a QA query before backfill).

## 6. Phases

### Phase A: confidentiality and integrity (P0, do first)

- [x] `participation()` with invariants 1-5; route record GET, queue rows,
      tabs, filters (C6), comments, flags through it.
- [x] Participant saves always write their own answer; ordinary saves never
      replace a confirmed double result (C1, C2, C7).
- [x] Remove plain assignments of non-participants on start and hand-over;
      hand-over keeps history (C4, S9).
- [x] Per-participant flag (C5).
- [x] Answer revisions (C3) with the rules in section 5.
- [x] Confirmed-path snapshot (`DoubleOutcome.resultCodes`, backfilled by
      the migration) and export status from it. Drift check:
      `scripts/sql/double-annotation-drift.sql` lists confirmed taxonomies
      whose labels were written after the decision (run it after deploying the
      migration; a reviewer decides those records again).
- [x] Integration tests: participant view during, after completion, after
      stop, after hand-over; filters and counts for participants; a
      labeller's revision after review leaves the result and export intact;
      response shape of the record GET equal for ordinary and double records.

Implementation notes (phase A): the snapshot is a `resultCodes` text array
on `DoubleOutcome` rather than a separate table. A labeller who is assigned a
record of a completed round they never took part in sees it as ordinary work;
their label changes export as `single`. Stopping or accepting a single label
cancels only parts without answers. "Give back as ordinary work" (built after
phase E): the bulk command `release` (one person, a reason) sets
`DoubleTask.releasedAt`/`releasedById` on that person's parts once no round of
the record is active, audited as `double.released`; `PARTICIPATING` (live and
not released) is the one participation predicate. The released part stays in
the history (the panel names it), the comparisons and the exports; the person
gets the record as ordinary work (assigned if it was not) and their changes
export as `single`. Tests:
`tests/integration/double-annotation-participation.test.ts`.

### Phase B: review mode (P1)

- [x] Tab states, comparison table, explicit decision with keys 1/2/3,
      note, "Save decision and next", undo toast, empty browser for "Other".
- [x] Override on agreed outcomes with reason (K5).
- [x] Record history panel and "Change confirmed result…".
- [x] e2e + axe for review mode.

Implementation notes (phase B): undo is an "Undo decision" button on the
decided taxonomy (`reopen` command) rather than a toast, because the screen
moves on to the next record after a decision. A manager's save on a
confirmed taxonomy needs `override: true` and `reviewNote` (409/400
otherwise), in an active round and on a completed one; bulk labels refuse
records with a completed round for supervisors and admins.

### Phase C: export (P1)

- [x] Status columns optional (default by workspace usage).
- [x] Analysis card: pairs, answers, agreement summary; double-specific
      filters; counts; link download.
- [x] `agreedDepth`/`firstDiffLevel` columns and backfill.
- [x] Export integration tests (pairs columns, leading zeros, unknown codes,
      formula safety, header collisions).

Implementation notes (phase C): `GET /export?format=pairs|details|agreement`
(`lib/export-double.ts`, answers = the extended details file) with
`rounds`, `taxonomy`, `comparedFrom`, `comparedTo`, `text=false`;
`statusColumns=true|false` on the records export (default: the workspace
has rounds); `GET /export/summary` gives the page its counts. Per-level
agreement is computed from the answers as compared (revisions current at
`comparedAt`) instead of a stored `agreedDepth`; identical paths agree at
every level. `format=analysis` (built after phase E) streams all three files
as one ZIP (`lib/zip.ts`: deflate and data descriptors with Node's `zlib`, no
dependency, each file read only when its turn comes; no ZIP64, so over 4 GiB
it fails). The export page offers it as "All three".

### Phase D: queue, start dialog, progress (P1/P2)

- [x] Double column, A/B codes in the review view, filter chips with counts.
- [x] Bulk accept/hand over/stop.
- [x] Start dialog: modes, automatic balanced second person, sampling,
      preview per person.
- [x] Progress: agreement by level, by labeller, top confusions with links,
      waiting age.
- [x] Optional blind review setting.

Implementation notes (phase D): bulk commands are
`POST /sentences/double-annotation/commands` (`accept_single`, `stop`,
`hand_over` from one person to another; `dryRun` counts what applies and why
the rest is skipped). The start route takes `secondUserId: 'auto'`
(labellers in the caller's scope, fewest open parts first) and
`sample`/`seed`; its preview adds `people`, `mixed`, `losingAccess`. Queue
stats add `double` counts (ignoring the double filter; four more counts only
when the workspace has rounds). Blind review is a per-browser "Hide names
while deciding" toggle, not a workspace setting. The counter reads "N records · M confirmed"
in double views. Each row of "Most frequent disagreements" links to the queue
filtered by `disagreement=<taxonomyKey>,<level>,<codeA>,<codeB>` (managers;
the answers as compared, either way round, over all periods, so the queue can
list more records than the period's count).

### Phase E: hygiene

- [x] Find the overlapping `pg` queries (K6).
- [x] Benchmark queue double filters at scale (open item from v1).
- [x] Update AGENTS.md, docs/security.md (participant rules), ENV/README
      only where behaviour changes.

Implementation notes (phase E): the overlap was inside Prisma, not in our
code: Prisma 7's query interpreter loads the relations of one query
(`include`) with `Promise.all` on the transaction's connection. The
`withWorkspace()` queue only orders whole Prisma operations, so
`lib/prisma.ts` now wraps the `pg` adapter (`SerialTransactionPg`) and runs
each transaction's statements one after another; the full integration suite
shows no warning any more.

Benchmark (`scripts/bench/seed-progress.ts` now seeds a round on every eighth
record of 50,000: waiting, needs review, agreed, reviewed; cases in
`tests/bench/progress.bench.test.ts`), local PostgreSQL 16, p50/p95 in ms:

| Call | Viewer | p50 | p95 |
| --- | --- | ---: | ---: |
| queue list, double=review | admin / supervisor | 95 / 144 | 111 / 196 |
| queue stats, double=review | admin / supervisor | 127 / 198 | 162 / 261 |
| queue list + stats, double=done | admin | 167 | 225 |
| queue list, disagreement | admin | 106 | 118 |
| queue list + stats, default view | admin / supervisor / labeller | 137 / 388 / 196 | 180 / 481 / 226 |
| queue list, own labels (code filter) | labeller | 139 | 159 |

The benchmark found one regression from phase A: the participant branches of
the status and flag filters (`own part` subqueries in an `OR`) made a
supervisor's default queue take about 2 s (stats 1.7 s). People who hold no
live part (most managers, labellers outside double annotation) now get the
plain filters (`holdsParts()` in `lib/server/sentences.ts`, one indexed
lookup): 2,055 to 388 ms. A manager who also labels double records still
takes the slower path.

## Handover (7 November 2026)

Commits on `staging` (not pushed): phase A `4dc4c5c`, B `5d485a0`, C
`e417fa3`, D `afc3a92`, a format fix `6c797c6`, phase E docs and the
workspace switcher (`26716bc`), then phase E (serial transaction statements,
the benchmark and its queue fix, counter wording, disagreement links).

Verified: typecheck, lint, unit tests, the double-annotation integration
suites (participation, manage, original: all pass), the full integration
suite after phase A (one AI-monitor test failed under load and passed alone),
production build, the full e2e suite after the switcher fix (68 of 69; the
one failure, `double-annotation.spec.ts`, was fixed afterwards but **not
rerun**). Browser checks on the demo workspace: participant views, review
mode with note and undo, history, export page and files, queue chips and
Double column, progress.

Second session (7 November 2026, evening): full integration suite 232/232
before the changes; after them 231/232, the one failure a `TRUNCATE`
deadlock in `ai-job-monitor.test.ts`'s reset against a job monitor of the
previous test (passes 3/3 alone; harness race, not product code).
The final run after all changes: 232/232, no `pg` warning.
Full e2e suite 69/69 after the changes. Its double annotation journey found
one more axe finding (the locked taxonomy browser under the review panel was
a scroll region without a focusable element; it is now a focusable, labelled
region while locked) and now also checks the double-view counter and the
progress page's disagreement link.

Open:

- Before deploying: run `scripts/sql/double-annotation-drift.sql` after the
  migration; a reviewer decides the listed records again.
- Built after phase E (8 November 2026): "give back as ordinary work"
  (migration `20261108090000_double_annotation_release`), the ZIP of all
  analysis files, and a retry of the test reset's `TRUNCATE` on a deadlock
  (`tests/integration/helpers.ts`) for the `ai-job-monitor` race above.
- Nothing from this plan is left to build, and the section 7 decisions are
  all taken (supervisor analysis export and kappa built on 8 November 2026).
- Local setup used: a throwaway PostgreSQL 16 cluster on port 5499
  (scratchpad), launch config `classiflow-double-local`. The Docker dev
  database container did not start (data from an older PostgreSQL major
  version) and was left untouched.

## 7. Decisions for the product owner

| Question | Recommendation |
| --- | --- |
| May labellers change a submitted double answer (C3)? | Yes, as revisions (section 5); otherwise lock submitted labels for *all* records in the workspace so behaviour is uniform |
| After a round completes, does the labeller see the final result? | No, never: they keep seeing their own answer |
| Status columns in the main export | Optional, default on only when the workspace used double annotation |
| Analysis export for supervisors (their team) | **Decided 8 November 2026: yes**, built (their visible records, without their own parts) |
| Blind review (no names for the reviewer) | Offer as a workspace setting, default off |
| Sampling and automatic second person | Yes, in the start dialog |
| Kappa | **Decided 8 November 2026: yes**, built (Fleiss' kappa by level, in progress and the agreement file) |
