# Double annotation

How independent double annotation works today (v1 from 22 October, v2 from
7-8 November 2026). The plans, review findings and mockups behind it are in
[`archive/double-annotation/`](archive/double-annotation/); open follow-ups
are in [open items](open-items.md).

Goal: supervisors pick two people, watch one state, and decide disagreements
on the record screen, without training.

## Code

| Part | Where |
| --- | --- |
| Pure rules (states, comparison, agreement, Fleiss' kappa) | `lib/double-annotation.ts` |
| Workflow (start, answer, compare, decide, commands, participation) | `lib/server/double-annotation.ts` |
| Queue column and state chips | `lib/server/double-queue.ts`, `components/queue/DoubleBadge.tsx` |
| Start dialog | `components/queue/DoubleAnnotationPanel.tsx` |
| Review panel and history on the record screen | `components/labeling/DoublePanel.tsx` |
| Analysis exports | `lib/export-double.ts` |
| Drift check after the v2 migration | `scripts/sql/double-annotation-drift.sql` |
| Tests | `tests/integration/double-annotation*.test.ts`, `tests/e2e/double-annotation.spec.ts` |
| Demo data (35 records in every state, team of demo.amina) | `scripts/seed-demo.ts` |

## Model

- `DoubleRound`: one active round per record, later rounds keep history.
- `DoubleTask`: two per round (position 1 and 2), two different people.
  Handing a part over cancels the task and creates a new one in the same
  position, so history keeps who held it. `releasedAt` marks a part given
  back as ordinary work.
- `DoubleTaskLabel`: a person's answer, immutable rows; a change is a new
  `revision`, the previous row gets `supersededAt`.
- `DoubleOutcome`: one per required taxonomy (the active taxonomies when the
  round starts). State `waiting | agreed | disagreed | reviewed |
  accepted_single`; the comparison (`matched`, `comparedAt`) is frozen
  when both answers exist (per-level agreement is computed from the
  answers);
  `resultCodes` holds the confirmed path; `revisedAfterCompare` shows a
  later change by a labeller.
- `SentenceAnnotation` stays the current, exportable result (the first
  answer while waiting or disagreeing). `Sentence.status` is `submitted`
  only when every required taxonomy is agreed, reviewed or accepted.
- `LabelingActivity.kind` is `label | review`; progress counts labelling.

## Starting a round

`POST /sentences/double-annotation`: preview with `dryRun`, then commit with
the previewed counts as `expect` (409 if they changed). Complete labels by
one known author become the first answer. Choose a first person to include
records without such an answer. The second person is chosen or
automatic (balanced across the team, never the first author, fewest open
parts first); an optional random sample (percent) of the selection. The
preview counts every case (`fresh`, `labelled`, `already`, `needs_first`)
and how many other labellers lose their plain assignment, so nothing is
skipped silently.

## Participation (the confidentiality rules)

1. **Sticky.** Whoever holds a part in any round of a record sees only their
   own work on it for good (own answer, comments, flag, status, edit time; no
   AI suggestions), also after the round completes, stops or the part is
   handed over. Only a manager's "give back as ordinary work" (`release`,
   closed rounds only) ends it.
2. **Same behaviour as ordinary work.** Participants can change a submitted
   answer, flag, comment and skip, with the same messages and response shape
   as ordinary records. In an active round the latest first answer is the
   provisional label while waiting or disagreeing. When the two current
   answers match, the taxonomy is confirmed. Reporting keeps the original
   comparison. After the round closes a revision updates only the person's
   own answer. For managers the record is flagged if the record itself or an
   unreleased part is flagged. Participants can only see and clear their own flag.
   Record flags already set at the time of an upgrade are retained.
3. **No side channels.** Tabs, counts, filters, sorting, editor and edit-time
   columns, comment counts, flags and AI reads come from the person's own
   part. No double-specific text reaches a labeller.
4. **No hidden records.** A labeller has a part or does not see the record.
   Labellers without a part do not see records of active rounds.
5. **Managers who label** a record are participants for it and review only
   records they did not label.

Every read path uses `participation()` / `participantWhere()` (predicate
`PARTICIPATING`). The access matrix is in [security.md](security.md).

## Review and manager commands

- A non-participant admin, or a supervisor whose team contains both
  labellers, decides on the record screen once both answers exist:
  *Use A* (`1`), *Use B* (`2`), *Other label* (`3`), optional note, "Save
  decision and next"; an undo toast reopens it. Agreed taxonomies show
  read-only with "Override…", which needs `override: true` and a reason.
  `reopen` undoes a decision. Closed rounds show as read-only history.
- Commands on one record (`POST /sentences/[id]/double-annotation`):
  `accept_single` (reason; not while disagreeing), `stop` (back to ordinary
  work, history kept), `reassign` (a part with no answer yet), `reopen`.
  On a selection (`/sentences/double-annotation/commands`, with `dryRun`
  preview): `accept_single`, `stop`, `hand_over` (unstarted parts from one
  person to another) and `release` (give one person's parts back as
  ordinary work).
- Bulk label and skip refuse selections with active rounds (409); bulk flags
  and comments work.

## Queue and progress

- Managers get a Double column (hidden without rounds), state chips
  *Waiting · Needs review · Needs another person · Confirmed* (stats
  `double`), a "Needs review · N" shortcut that opens review mode, and the
  disputed codes (`A 2221 · B 2222`) in the review view. Filters: `double`
  (`any | review | waiting | gap | done`) and `disagreement`.
- Progress has a "Double annotation" section: open and confirmed counts,
  agreement by level (share and Fleiss' kappa, full path too), by labeller,
  top disagreements linked to the queue, waiting age.

## Export

- Records export: unchanged columns plus, when `statusColumns` is on
  (default only in workspaces that used double annotation),
  `annotation_mode`, `annotation_status` and
  `{taxonomyKey}_annotation_status`. `labels=confirmed` keeps confirmed
  records only. Drifted labels (the path no longer matches `resultCodes`)
  report as `single`.
- Analysis files (`lib/export-double.ts`), filtered by `rounds`, `taxonomy`,
  `comparedFrom/To`: `format=pairs` (A and B side by side, match per level,
  final result), `format=details` (one row per answer), `format=agreement`
  (by level, pair, labeller; confusions; `kappa`), `format=analysis` (all
  three as a ZIP). Admins get the workspace; supervisors their visible
  records minus their own parts (`analysisScope()`).
- Learning uses `submitted` records, so double records count once confirmed.
