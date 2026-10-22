# Progress dashboard: implementation plan

**Archived 22 October 2026:** implemented. What is still open (environment,
maintainer decisions, Taxomind) is in [open items](../../plans/open-items.md).

**Status:** D0–D3 implemented 22 October 2026, D4 verified locally (see below); the staging-host benchmark under concurrent load is open.
**Priority:** follow-up feature after the existing modernization and feature plans.
**Reviewed baseline:** `fae270f` plus the in-progress working tree on 21 October.
The deployed older UI was described by the maintainer, not profiled in this review.

## Implementation status (22 October 2026)

Built on `staging` `addc0a7` (workspaces, Better Auth, Prisma 7, `lib/server/*`);
D3/D4 on the merged overnight lanes (`17eeb76`, with M06 part 1's TanStack
Query, nuqs and Radix conventions). **The Progress page is the new dashboard**;
the old `stats`, `timeline` and `team` endpoints, their server functions and
`lib/metrics.ts` (AI agreement) are gone.

**D0, decisions recorded** (defaults chosen overnight; change them here if needed):

- Metric definitions are the table in "Metric contract" below, implemented
  as written. Remaining now = total − complete (pending + skipped +
  escalated, each also returned). A person filter narrows workload by current
  assignment and activity by author; both stay inside the viewer's current
  record visibility. Team = the selected member's **current** subtree.
  Team + person = intersection (an empty one is a valid, zero result).
- **Reporting time zone:** `Workspace.reportingTimezone` (IANA name, set by
  workspace admins with `PUT /api/workspaces/[id]`), else the deployment's
  `REPORTING_TIMEZONE`, else UTC. Inclusive local dates become
  `[local midnight, local midnight after the end)`; weeks start on Monday and
  edge weeks are clipped; DST days are calendar days (`lib/reporting-dates.ts`,
  unit tested with Berlin, New York, Kolkata and Santiago's skipped midnight).
  Defaults: the last 7 days; at most 731 days; at most 366 buckets (daily
  timelines longer than that must use weeks).
- **Coverage:** `Workspace.activityTrackedSince` (default: creation; existing
  workspaces: when the migration ran). Every report returns it as
  `activityCoverageStart`; nothing before it is invented.
- **Retention and deletion:** activity rows go with their record (import
  deletion) or taxonomy (hard delete), are kept with a null actor when an
  account is deleted, and are otherwise kept for as long as the workspace.
  Workspaces are only archived, never deleted.
- **Selectors:** `personId` and `teamId` are user ids. One outside the
  caller's scope (or unknown in this workspace) is a **403**, never a wider
  result; labellers may only select themselves and no team.

**D1 activity source:** `LabelingActivity` (migration
`20261022120000_progress_activity`): workspace, record, taxonomy, actor,
operation id, time; no record text or codes. Written in the same transaction
by the single and bulk label saves (`lib/labeling-activity.ts`), one row per
record per save; flag-, comment-, skip-only saves and AI suggestions write
none. An optional `operationId` (UUID) in the save body makes a replayed
request record nothing new (unique `(workspaceId, operationId, recordId)`);
the browser sends one per save attempt and reuses it on retries (D3,
`lib/save-operation.ts`). Row
security like every workspace table; a trigger makes the table append-only
(the only update allowed is the actor's `ON DELETE SET NULL`).

**D2 reporting:** `lib/server/progress.ts` `getProgressOverview`,
`getProgressActivity`, `getProgressPeople`, served by
`GET /api/workspaces/[id]/progress/overview`, `/activity`
(`granularity=day|week`) and `/people` (`q`, `sort` = name, role, assigned,
complete, remaining, labeled, lastSeen; `dir`; `page`; `pageSize` 25, at most
100; supervisors and admins). Types in `lib/contracts/progress.ts`. Each call
is a fixed number of SQL statements (4–5, people at most 6, including the
transaction's own), whatever the team size: the supervisor subtree is one
recursive query (`teamMembers()` in `lib/access.ts`), the figures one grouped
query. People rows include suspended members (`status`) and their history.
`tests/integration/progress-reports.test.ts` covers attribution, rollback,
replay, append-only and deletion, AI-only records, admin/supervisor/labeller
scopes, shared assignments, reassignment, selector denial, two workspaces,
time zones and bucket filling, paging and the query count (4 vs 40 members).

**M07 (from the modernization plan), done in the same change:** the old team
handler's per-member queries (392 statements for 53 members) are one grouped
query with the same response; `tests/bench` checks that both give identical
figures on the seeded data. Queue text search uses `pg_trgm` GIN indexes on
`field1`–`field5`. Finding: **row security keeps those indexes from the
runtime role** (ILIKE is not leakproof, so it may not run before the policy's
condition), so terms of 3+ characters are looked up through
`app_search_sentences()`, a narrow owner-run function limited to the current
transaction's workspace that returns ids (up to 5,000; more falls back to the
plain filter, where a scan is the right plan anyway).

**Indexes:** the event table's `(workspaceId, createdAt)`,
`(workspaceId, actorId, createdAt)` and `(sentenceId)`, plus the trigram
indexes. `EXPLAIN (ANALYZE, BUFFERS)` at 50,000 records as the runtime role:
a 7-day activity count uses `(workspaceId, createdAt)` (bitmap scan, 2,216
rows); the 2-year count for a whole-workspace supervisor scans the 66,666
events and hash-joins 60,000 assignments (~110 ms with EXPLAIN overhead);
workload counts hash-join assignments to records (~60 ms). No further index
helped those plans, so none was added. Note for raw SQL: compare
`timestamp` columns with `timestamp` parameters; `now()` (timestamptz) makes
the comparison non-leakproof, and under row security the planner then ignores
the index and estimates one row.

**Benchmark** (`scripts/bench/seed-progress.ts`, `npm run bench:progress`,
DEVELOPMENT.md "Benchmarks"). Setup: this container (4 vCPU, 15 GB, local
PostgreSQL 16, not a staging-like host), application as the runtime role, 10
runs after 2 warm-ups, **other builds and test suites running at the same
time**, so treat the numbers as a before/after comparison, not as the D4
budget check. Data: one workspace, 53 members (head supervisor, 3
supervisors, 48 labellers of whom 12 suspended), two taxonomies (3 and 2
levels), every fifth record shared by two labellers, 70% labeled over 180
days (2.9 annotations per record), 1.33 activity events per record, 30%
with AI suggestions. p50 ms (statements), admin unless noted:

| Call | 10k | 20k | 50k |
| --- | ---: | ---: | ---: |
| old stats, 7 days | 85 (18) | 106 | 137 |
| old stats, 7 days, supervisor | 166 (25) | 148 | 238 |
| old stats, 2 years | 274 | 671 | 1,076 |
| old timeline, weekly, 2 years | 540 (3) | 1,002 | 2,626 |
| old team, 7 days | 983 (392) | 1,534 | 3,999 |
| old team, 7 days, supervisor | 766 (388) | 1,258 | 3,238 |
| old team, 2 years | 1,089 (424) | 1,883 | 4,879 |
| team, grouped, 7 days | 22 (3) | 30 | 74 |
| team, grouped, 7 days, supervisor | 18 (4) | 36 | 73 |
| team, grouped, 2 years | 48 | 94 | 257 |
| overview, 7 days | 5 (4) | 8 | 16 |
| overview, 7 days, supervisor | 16 (5) | 25 | 64 |
| overview, 2 years, supervisor | 26 | 44 | 115 |
| activity, daily, 7 days | 3 (4) | 3 | 10 |
| activity, weekly, 2 years, supervisor | 34 (5) | 57 | 158 |
| people, 7 days, supervisor | 20 (5) | 34 | 73 |
| people by labeled, 2 years, supervisor | 48 | 70 | 192 |
| queue list, q=a1b2 (12 matches) | 30 | 14 | 13 (before: 96) |
| queue list, q=engineer (10% match) | 54 | 49 | 102 (before: 115) |

Worst p95 of any new report at 50k: 271 ms (people by labeled, 2 years,
supervisor), inside the 750 ms query budget. Responses: overview ~350 bytes,
2-year weekly timeline ~8.7 KB, a people page ~5.2 KB. The old stats endpoint
(lastEditedAt-based, AI agreement, median time) is not replaced: D3 drops the
cards it feeds, as "First-release experience" says.

**D3 dashboard** (`app/w/[workspaceId]/progress/page.tsx`, `components/progress/`):

- Filter bar: Last 7 / 30 / 90 days / 12 months (`days`, so a shared link
  keeps meaning "the last 30 days"; the reports accept `days` instead of a
  start date) or custom dates with Apply (validated: order, at most two
  years); Team (a supervisor or admin: their current subtree) and Person
  (Radix `Combobox`, suspended members marked "inactive"), for admins and
  supervisors only; labellers see their own work and no directory. Choosing
  a team that does not contain the selected person clears the person and
  announces it. The whole view (range, team, person, granularity, people
  search/sort/page) is in the URL (`lib/progress-url.ts`, nuqs), with the
  API's parameter names; the server page reads the same parsers.
- Sections: overview cards (Total, Complete with %, Remaining with the
  pending/skipped/escalated split, Labeled in period), activity (bar chart,
  Daily/Weekly with daily disabled beyond 366 days, "Show as table"
  alternative, a summary as the chart's accessible name), people (sortable
  headers with `aria-sort`, debounced search, 25 per page, a name selects that
  person). Each section is its own TanStack Query
  (`queryKeys.progressReport`) with its own skeleton, "Updating…", error and
  Retry; previous results stay on screen while reloading **only for the same
  team and person** (`placeholderData` checks the scope key), so another
  person's figures never appear under a new selection.
- The server renders the URL's view through `lib/server/progress.ts` with the
  same query strings and hands it over as `initialData`, so mounting makes no
  request (the e2e journey checks this). Header: last update time and
  Refresh (invalidates the workspace's progress queries). The range line
  names the dates, scope and reporting time zone; workspace admins change the
  zone there (`PUT /api/workspaces/[id]`, "Use the deployment default"
  resets it). A notice explains when activity history starts inside the
  selected period.
- `operationId`: the labelling screen and the bulk panel send one per save
  attempt and reuse it when the same labels are sent again after a failure
  (`lib/save-operation.ts`), so a lost response does not double-count.

**D4 verification (local):** `tests/e2e/progress.spec.ts` (period presets
across reload and back/forward, custom range validation and server-rendered
restore, team/person filters with the clear-and-announce rule, keyboard
sorting, a section failing on its own and recovering with Retry, the table
alternative, the time zone dialog, axe on the page and dialog, every report
response under 100 KB, no requests on mount); `tests/integration/progress-reports.test.ts`
"counts reconcile with the fixture" (17 records, shared assignments, repeated,
bulk and admin saves: overview, timeline and people rows against the truth
kept while saving, for admin and supervisor). Benchmark at 50,000 records
(same container and seed as above, another lane's builds running, load
average ~4; p50/p95 ms, statements):

| Call | Viewer | p50 | p95 | Statements | Bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| dashboard page (overview + activity + people), 7 days | admin | 83 | 122 | 8 | 6,391 |
| dashboard page (overview + activity + people), 7 days | supervisor | 153 | 174 | 11 | 6,402 |
| overview, 2 years | supervisor | 128 | 214 | 5 | 358 |
| activity weekly, 2 years | supervisor | 173 | 202 | 5 | 8,709 |
| people by labeled, 2 years | supervisor | 201 | 263 | 5 | 5,255 |

The page's three reports together stay under 200 ms p95 for the default view
and every single report under the 750 ms budget; the largest response is the
2-year weekly timeline (8.7 KB).

**Left:**

- D4 on a staging-like host with the agreed concurrent load (10 viewers plus
  labeling writes) and the browser timings of the budget table; then release
  through staging.
- ~~Platform admins without a membership have no people row~~ done 22
  October 2026: an admin's unrestricted people view also lists them
  (`platformOnly`, badge "Platform admin", not selectable).
- ~~People pickers list the whole membership~~ done: the team and person
  pickers search the server (`/progress/members`, 20 matches, "type a name to
  find more"); the page no longer loads the member directory.

## Outcome and place in the roadmap

Replace the existing Progress page with a calm, modern dashboard that answers:

1. How much work is complete, and how much remains?
2. How has labeling activity changed over the selected period?
3. Who is doing that work, individually and within a supervisor's team?

Opening the page with 10,000, 20,000 or 50,000 records should feel routine.
Fast filtering and trustworthy counts matter more than adding metrics.

Schedule this **after** the [modernization plan](modernization-2026-10.md),
[user-management plan](user-management.md), and
[workspace-isolation plan](workspace-isolation.md), plus features already ahead
of it in the agreed backlog. This document does not reorder that work. In
particular, reuse M05's shared server data layer, M06's frontend conventions,
M07's query improvements and the final workspace authorization boundary.
Do not hold up those plans to build this dashboard.

**Mandatory first step when work starts:** review the repository again. Existing
plans and the observations below are dated evidence, not a specification of
the future implementation. Record the new commit, completed prerequisites,
actual stack, schema, access rules, API contracts, query plans and performance
baseline before deciding which changes remain necessary. Framework upgrades
alone do not establish that the dashboard's queries are fast.

## What the current code tells us

This review inspected the Progress server page and client, all three progress
routes, the schema, access helpers, and single/bulk annotation writes. The
working tree already contains modernization changes, including newer framework,
Prisma and auth dependencies; older guide text does not fully describe it.

| Observation | Implication for the redesign |
| --- | --- |
| `app/progress/page.tsx` waits for stats, timeline and team through self-HTTP, although those initial requests run in parallel | Reuse M05's direct server functions and render sections independently; do not repeat its extraction |
| `ProgressPageClient.tsx` fetches stats, timeline and team sequentially after filter changes | Independent sections must update concurrently with cancellation and stale-response protection |
| Loading replaces the whole page; failures can leave old values or apparent zeroes without an explicit error | Keep filters and layout stable; identify loading, stale, empty and failed states separately |
| Timeline reads matching records into Node, then repeatedly filters them for each date | Aggregate in PostgreSQL and return bounded time buckets |
| Weekly mode advances the requested dates by seven days but compares records to individual dates | Build actual week buckets and test boundaries and gap filling |
| Team route loads all assigned record IDs and runs multiple counts, timing and agreement queries per member | Replace member-by-member work with grouped queries; paginate the returned people |
| Stats retrieves annotations and AI suggestions into memory and performs many sequential operations | Keep the default overview small; use database aggregation and defer optional measures |
| Some measures scope records by assignment, others annotations by author | Apply record visibility and actor selection explicitly to every aggregate |
| “Completion rate” divides completions in a date range by all visible records | Separate current completion percentage from activity during a period |
| `lastEditedAt` can change for labels, flags or comments; annotations are replaced on save | Neither is a durable history of who completed work on which day |

These are plausible contributors to the reported slowness, not measured timings
or a claim that all are unchanged in production. M05/M07 may fix several first.
Single and bulk labeling already share completion helpers in the reviewed tree;
preserve that behavior rather than relying on older descriptions of divergence.

## First-release experience

Keep the existing Progress navigation entry inside the active workspace. Match
the application's established teal palette, typography and component primitives.
Use clear spacing, restrained borders and readable numbers. Do not introduce a
separate visual system or a dashboard customization product.

```text
Progress                                  Updated 14:32   Refresh
[Active workspace] [Supervisor team: All] [Person: All]
[Last 7 days | Last 30 days | Custom dates]   Reporting timezone

[Total records] [Complete now / %] [Remaining now] [Labeled in period]
 Workload now                                      Activity in range

Labeling activity over time                     [Daily / Weekly]
One chart with a clearly labeled count and accessible table alternative

People                              [Search] [Sort] [Page controls]
Person | Assigned now | Complete now | Remaining now | Labeled in period
```

- Default to the last seven reporting days, with explicit dates visible.
- Admins can choose a supervisor subtree and/or a person within their authorized
  workspace. Supervisors start with their own permitted subtree, including
  themselves; labellers see their own permitted work and no staff directory.
- Person filtering is a single selection in v1. Supervisor plus person means
  intersection, not union. Clear a person selection that becomes invalid when
  the team changes and announce that change.
- Search staff by permitted display name/username. Show names and roles, not
  unnecessary email addresses. Include inactive former staff in historical
  reporting where the lifecycle policy allows it, with a clear inactive badge.
- Store filters, sort and page in the URL using the conventions landed by M06.
  Back/forward navigation and shared authorized links must reproduce the view.
- Summary cards and chart describe the entire filtered scope, never just the
  current table page. Selecting a person from the table applies that filter.
- Label workload cards “Now.” Date selection affects activity, not the current
  workload denominator. The table makes the same distinction in its headings.
- On small screens, filters wrap, cards become a compact grid and the people
  table scrolls within its container. No page-wide horizontal overflow.
- Keyboard-operable pickers, visible focus, sufficient contrast, meaningful
  chart labels and a text/table alternative are acceptance requirements.
- Show last successful update and manual refresh. No continuous polling in v1;
  a deliberate refresh on returning to a stale visible page can use Query's
  established policy. Retain matching data while refreshing, with a subtle
  indicator. Never display a previous person's data under a newly selected
  person's heading; use a section skeleton until matching data arrives.

Do not carry every existing card forward. AI agreement, timing, velocity,
completion forecasts, comment counts and unknown-by-level rates are outside the
first release. Flags/skipped/escalated remain available in the queue; a compact
status breakdown can accompany workload if it improves clarity without adding
another expensive report. This dashboard must work with AI entirely disabled.

## Metric contract before implementation

Write these definitions into shared types, tests and short UI help. Use
“records” in the UI; retain the internal `Sentence` model name where appropriate.

| Measure | Proposed definition |
| --- | --- |
| Total records now | Distinct currently visible records, narrowed to the current assignments of the selected person/team when either is selected; workspace-wide admin view also includes unassigned records |
| Complete now | Those records currently `submitted` according to the existing human-completion rules; suggestions alone never count |
| Completion percentage | Complete now / total now; show an empty-state explanation for a zero denominator |
| Remaining now | Total now minus complete now; includes pending, skipped and escalated, with that definition visible |
| Labeled in period | Distinct authorized record IDs with a successful human label save by the selected actor(s) in the range; a multi-level path or a bulk save does not multiply one record into several labels |
| Activity chart | The same distinct-record activity definition within each day/week bucket |
| People rows | Workload uses the person's current assignments; activity uses the actual actor, subject to current viewer record visibility |

Deduplicate shared assignments with `EXISTS` or distinct record sets. Workload
per-person rows overlap when records are assigned to several people. Activity
rows also overlap when several people label the same record. Therefore row sums,
and sums of daily distinct counts, need not equal the whole-period distinct
count. Explain this and compute totals directly instead of summing rows.

Selecting a person narrows the workload by assignment and activity by author.
Do not additionally require that author to still be assigned to every record
they labeled: reassignment is not authorship. Both datasets remain intersected
with the viewer's current record permissions. The two sections describe related
but different sets and must say so.

Supervisor selection means **current** subtree membership in v1. Historical
team membership and “workload as it looked on a past date” are not supported.
Likewise, the chart reports labeling activity, not net growth in completed
records. A later change of labels or completion requirements must not rewrite
an earlier successful activity event.

## Reliable activity history without an analytics platform

Recommended approach: introduce a small append-only labeling-activity table,
unless the refreshed repository already provides an equivalent durable source.
Do not reconstruct a historical activity chart from `lastEditedAt`, mutable
annotations, last-seen heartbeats, or general audit logs without checking their
coverage. Current state can support the workload cards immediately.

- Record one event per record with human labels successfully saved, carrying
  workspace, record, actor, affected taxonomy, server timestamp and operation
  identity. A bulk operation has one event per affected record. Keep record text,
  tokens and unnecessary label payloads out of it.
- Write the event in the existing label transaction, for both single and bulk
  paths. Failed or rolled-back saves produce no activity. Comment-only,
  flag-only, suggestion generation and status-only saves produce none.
- For v1, a successful label save counts even if the same code is saved again;
  repeated saves of that record in the same reporting bucket still count once.
  This is activity, not a measure of changed labels or individual productivity.
- Use operation identity plus record identity to prevent duplicate events for
  a replay of the same operation. Reuse any existing mutation idempotency
  mechanism; do not deduplicate legitimate later saves by timestamp alone.
- Let the event source support period-wide distinct counts and day/week buckets.
  Do not store one event per annotation level or add completion-transition
  reporting merely to populate this initial dashboard.
- Do not invent pre-launch events. Return an activity-coverage start timestamp;
  label partial historical ranges clearly. Current annotation snapshots may be
  used only for a separately named snapshot report, never silently as history.
- Resolve deletion/retention behavior against the landed workspace and account
  lifecycle policies. Workspace/record deletion must not leave unauthorized
  reportable data. Deactivation should not erase history; if hard deletion is
  permitted, define anonymized actor presentation and visibility explicitly.

This is a focused addition to the label transaction, not event sourcing for the
application. No broker, extra worker service or warehouse is proposed. If this
history change is deferred, ship workload-only first and explicitly defer the
historical activity feature; do not ship misleading charts as a substitute.

## Data access and performance design

Use the shared server module established by M05, with a validated workspace and
authenticated viewer context. Pages and API handlers call the same functions.
Preserve current authentication, forced-reset and failure behavior as adapted
by modernization. Every API performs its own authorization.

Prefer independently loadable overview, timeline and paginated people queries;
the existing three endpoints can evolve if still appropriate. Choose exact
paths after the workspace routing review. Return lean, typed aggregates with
normalized filters, reporting timezone, generated-at time and activity coverage.
Never return record lists just to count them in the browser.

1. **One scope definition.** Resolve the permitted workspace, team, selected
   actor and record filters once per request. Use the landed scoped client/RLS
   boundary, including in raw SQL and nested joins. A requested ID never expands
   authority. Reject unauthorized selectors according to the established API
   policy; do not silently fall back to “everyone.”
2. **Grouped database work.** Use conditional aggregates for status counts,
   date bucketing for activity and grouped assignment/actor queries for people.
   Aggregate record, assignment and activity sets separately before joining to
   avoid multiplying rows. Query count must not grow with the number of staff;
   putting the old per-person queries in `Promise.all` is insufficient.
3. **Bound every response.** Initial people page: 25, maximum 100, stable sort
   with an ID tie-breaker and total matching count. Search/filter on the server;
   bound or paginate picker options as well. Chart: at most 366 buckets; choose
   daily/weekly granularity explicitly and enforce a maximum supported range
   (initial proposal: two calendar years, weekly for long ranges).
4. **Dates have one meaning.** Use a configured workspace reporting timezone,
   or an explicit deployment default if the workspace has none. Interpret
   inclusive date inputs as `[local start midnight, midnight after end date)`
   converted to UTC. Share normalization between server and client; validate
   malformed/reversed/oversized ranges and granularity. Define weeks as Monday
   starts, aggregate real buckets, and clip partial edge weeks to the range.
   Fill empty buckets after aggregation and handle DST without adding fixed
   24-hour intervals to local dates.
5. **Measure indexes.** Capture `EXPLAIN (ANALYZE, BUFFERS)` on representative
   PostgreSQL data. Evaluate workspace-leading assignment, status and event
   indexes, especially event time/actor/record access paths. Choose migrations
   from measured plans and account for write/storage cost; avoid speculative
   indexing of every possible combination. Use the safe parameterized SQL or
   TypedSQL conventions already established by M07.
6. **Responsive data loading.** Render the shell immediately; stream/suspend
   sections using the landed Next.js conventions. Hydrate the same Query keys
   used for client updates so mount does not duplicate initial requests. Fetch
   independent sections concurrently and pass abort signals. Keep query
   concurrency within the configured database pool budget.
7. **Cache within authority.** Reuse TanStack Query with an initial freshness
   target of 30 seconds. Keys include viewer/session authority identity, active
   workspace and every metric-changing filter, timezone, page and sort. Clear
   data on logout or workspace/access changes using the established mechanism.
   Server authorization remains authoritative on every request. Do not add a
   shared public Next.js cache for private reports. Start without server-side
   aggregate caching; add it only with an explicit permission-safe invalidation
   policy if measurements require it.
8. **Avoid refresh churn.** Debounce staff search, apply custom ranges only
   when valid (an Apply control is appropriate), and reset table pagination on
   scope changes. Each section supports retry without blocking the others.

Start with indexed live aggregation. Add PostgreSQL rollups/materialized views
only if the measured targets below cannot be met. Such a follow-up needs explicit
freshness, repair and deletion rules; it is not the default solution to 50,000
records. Do not add Redis or another infrastructure dependency for this page.

## Performance budget and evidence

These are proposed acceptance budgets, not results already achieved. Agree on
and record a staging-like host/database, browser, network conditions, dataset
seed and concurrent load in D0; do not silently weaken targets after testing.

| Scenario | Target at 50,000 records |
| --- | --- |
| Navigation to visible shell and filters | Within 500 ms on the agreed test setup |
| Navigation to useful summary and chart, cold application cache | p95 at most 2 seconds |
| Filter change to updated visible core data | p95 at most 1 second |
| Individual reporting API/server query group | p95 at most 750 ms under agreed concurrent load |
| Response size | Each overview/timeline/people response at most 100 KB uncompressed; no raw record payloads |
| Scaling | Fixed query count per section independent of staff count; no record-sized Node arrays |

Benchmark 10k, 20k and 50k records; use 100k as a diagnostic headroom run. Include
multiple taxonomies and annotation levels, multiple saves per record, shared
assignments, nested teams, many inactive staff, zero activity and skewed teams.
Record event-table size, not only record count: repeated labeling grows history.
Suggested starting concurrent load: 10 dashboard viewers with labeling writes
continuing; calibrate to the deployment and retain the chosen number in results.

Measure short and maximum ranges for admin, supervisor and labeller, with cold
and warm application caches. Report sample counts, p50/p95 latency, SQL query
count/time, rows scanned, response bytes, Node memory and pool contention.
Separate database-cache effects from client-cache effects. Retain baseline and
after results alongside the implementation review. Exact timing thresholds
belong in a repeatable benchmark on controlled hardware, not flaky unit tests.

## Delivery sequence

Each package should be a reviewable change with its own acceptance evidence.

| Package | Work | Exit gate |
| --- | --- | --- |
| D0 — refresh and measure | Re-review landed plans/code, inventory current routes and scopes, benchmark existing Progress, agree metric/timezone/retention rules and sketch the UI | Updated baseline, definitions and performance setup recorded; remaining scope confirmed |
| D1 — activity source | Reuse or implement transactional labeling events, coverage metadata and single/bulk write integration | Correct attribution, rollback, replay, deletion and workspace tests pass; no invented history |
| D2 — fast reporting | Shared scope/filter parser, grouped overview/timeline/people queries, bounded responses and measured indexes | Correct results and role/workspace isolation; fixed query count; backend performance budget met |
| D3 — dashboard UI | Responsive cards/chart/table, authorized selectors, URL state, Query integration, independent loading and errors | Person/team/date journeys work, accessibility checked, no mount refetch or stale-scope display |
| D4 — release verification | Production-build benchmarks, integration/browser suites, documentation and staging review | Counts reconcile with fixture truth; end-to-end budget met; deploy/rollback steps reviewed |

Do not estimate calendar dates from the current working tree. D0 should size the
remaining packages after modernization and workspace work land. If M07 already
delivers the grouped team queries, reuse them and remove that duplicate work.

## Validation and release checklist

- Unit tests: metric deduplication, scope intersection, date normalization,
  inclusive end dates, DST transitions, Monday weeks, partial weeks, zero
  denominators, bounds, stable filter keys and invalid filter handling.
- PostgreSQL integration tests: admin/supervisor/labeller results, nested and
  empty teams, shared assignments without fan-out, multiple taxonomies/levels,
  labels from several people on one record, reassignment, human versus AI-only
  records, status breakdown, event rollback/replay and deletion policies.
- Isolation tests: two workspaces with overlapping people/record keys; denied
  person/team IDs, all aggregates and selectors, raw SQL under the actual
  runtime role, changed membership/role and deactivated sessions. Extend the
  existing access-control suite whenever visibility rules change.
- Browser journeys: person/team/date filters, URL restoration, workspace
  switching during pending requests, rapid filter changes, independent section
  failures/retry, empty/partial-coverage states, mobile layout, keyboard access
  and chart alternative. A late old request must never overwrite new data.
- Benchmark the production build with the representative fixtures above;
  verify dashboard reads do not materially degrade concurrent label writes.
- Run typecheck, lint, unit tests, relevant PostgreSQL integration tests, build
  and the Progress/access browser journeys. Report unrelated failures separately.
- Put metric definitions and historical coverage in user-facing help; record
  reporting timezone configuration in ENV_SETUP if environment-configured and
  operational benchmark/query guidance in DEVELOPMENT or DEPLOYMENT as appropriate.
- Release through staging and the existing promotion process. Verify staged
  aggregate counts against known fixtures before production. Never push to main
  directly. If production data exists by then, use an additive migration and
  deployment-compatible schema changes, not the earlier fresh-start assumption.
- Document rollback before release: the new event table can remain if UI/read
  changes are reverted, but rolling back the event writer creates a history
  coverage gap. Preserve and disclose that gap when reporting resumes.

## Deliberate limits

No configurable KPI builder, rankings, productivity scores, attendance tracking,
cross-workspace global dashboard, historical team reconstruction, live sockets,
scheduled report email or dashboard-specific export in v1. Existing CSV export
continues in its own workflow. Optional AI quality and timing diagnostics can
be considered later only with a concrete user need and reliable definitions.

The first release is complete when a user can open Progress quickly, understand
current workload, filter genuine labeling activity by authorized person/team
and time, and trust both the counts and the loading/error states.
