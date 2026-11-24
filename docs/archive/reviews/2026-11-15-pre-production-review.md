# Pre-production review (15 November 2026)

Historical snapshot of the November release review. The checkboxes reflect
the review and its initial follow-up. See [open work](../../open-items.md) for
current status and the [Coolify guide](../../../COOLIFY_DEPLOYMENT.md#releases)
for the release procedure.

The later 16 November commit `5333a3d` addressed the same-tab Back warning (F2),
legacy escalated status handling (Q1), progress date helper simplification
(P5), export preparation errors (AD4), participant flags and revised answers
(DA3, DA6, DA7), the start form (DS3), active job and learning request bounds
(A12), and retries for definite transient mail failures (A17). It added queue
date and level validation (Q3). Queue dates still use UTC. The hosted n8n
verification recorded below is complete.

## Follow-up on 16 November 2026

The maintainer confirmed the hosted n8n webhook works and execution data is
discarded. The hosted upload and production database checks were removed.
The browser suite still exercises the 15 MiB upload locally.

Commit `5987eb1` passed typecheck, lint, formatting, a production build,
180 unit tests, 249 PostgreSQL integration tests and 72 Chromium browser
tests. Docker smoke testing confirmed database connectivity and row security.

- **F2.** Reloads, closing the page, queue and record navigation, and sidebar
  and workspace switches prompt for unsaved labels. The browser Back action
  within the same tab still needs coverage.
- **Q2 / P4.** The local benchmark on 50,000 records and 6,250 double
  annotation rounds measured 354 ms p95 for the searched queue counts
  and 889 ms for the supervisor's two-year overview. The mixed load measured
  875 ms for reads and 802 ms for writes at p95. Use these as local reference
  measurements. The longer reports still exceed the 750 ms query budget.
- **A7 / A12.** In-flight starts are cancelled if the local job was already
  stopped. Remote start deduplication still needs Taxomind. Labelling requests
  are bounded and reject overlaps, and job history pages in SQL. The active
  job list and learning request size still need bounds.
- **O9 / O16 / O19 / O20.** Compose rotates app logs, uses the same AI defaults
  as the app, and the server process drops bootstrap-only values from its
  environment. API responses have a CSP and the framework header is off.
  Resource sizing, broader environment validation, the database owner setup,
  and the remaining header work are open.
- **O10 / O11.** The GitHub production environment is restricted to `main`.
  Move the two Coolify values into its secrets and remove their repository
  copies. CodeQL ran successfully. CI now audits runtime dependencies and
  checks dependency changes on pull requests. The image scan threshold is
  still open.

## Coverage: what was and was not reviewed

| Part | State |
| --- | --- |
| Automated checks (typecheck, lint, format, unit tests, audit, outdated) | done |
| AI jobs, mail, logging, audit log | reviewed, findings below |
| Operations, CI, deployment, tests | reviewed, findings below |
| Documentation | reviewed, findings below |
| Packages | reviewed, findings below |
| Authentication and authorization (all 69 API route files, pages) | reviewed by the lead reviewer, findings below |
| Database, row security, migrations, workspace isolation | reviewed by the lead reviewer (less deep than auth: query performance and every migration statement were not traced), findings below |
| Labelling, record import, CSV escaping, status rules | reviewed, findings below |
| Double annotation (rules, workflow, routes, screens) | reviewed in full, defects and simplifications below |
| Queue filters and paging, taxonomy CSV, progress dates | reviewed, findings below |
| Progress report SQL, analysis export row logic | reviewed, findings below (the "details" and "agreement" files were read less closely than "pairs") |
| Frontend: labelling screen, double annotation screens, queue page | reviewed, findings below |
| Frontend: records, export, AI jobs and AI settings screens | reviewed, findings below |
| Frontend: Users screens, filter panel, progress dashboard, sidebar | data and error handling reviewed; markup not read line by line. The taxonomy admin dialogs were not opened |
| Behaviour in a browser | queue and record screen checked at three widths with demo data as a supervisor. Not checked: the admin and Users screens, the labeller's view, dialogs, dark corners such as very long text |
| Integration tests, e2e tests, production build | not run |

Every part has now been read. What remains thin is named in the table: the
taxonomy admin dialogs, the markup of the Users screens, and browser checks
beyond the queue and the record screen. Integration tests, browser tests and
the production build were not run.

How to read the findings: every finding comes from reading the code, nothing
was executed against a database or a running service. "Verified" means the
lines were checked a second time by the lead reviewer; "reported" means one
reviewer traced it and it was not rechecked; "suspected" means it depends on
behaviour that could not be seen from the repository.

Verified a second time by the lead reviewer: A1, A2, A10/O12, O1, O4, O5 and
D1. Everything else is "reported".

## Automated checks (working tree of `staging` with the uncommitted changes)

- `npm run typecheck`, `npm run lint`, `npm run format:check`: all pass.
- `npm test`: 31 files, 178 tests, all pass.
- `npm audit --omit=dev`: 0 vulnerabilities in production dependencies.
- `npm audit` with dev dependencies: 10 findings (9 moderate, 1 high), all in
  build and lint tooling: `postcss` 8.5.6 (fixed in 8.5.33) and `minimatch`
  through `eslint` 10.13.0 (fixed by `eslint` 10.15.0).
- The checks ran on Node 22.21 (this machine); `engines` asks for Node 24.

## Top items before production

In the order I would do them. Details are in the sections below.

1. "Undo decision" in double annotation can confirm a result nobody agreed
   on (DA1).
1a. CSV files from Excel: wrong encoding is imported silently and semicolon
   files are refused (L1, L2).
1b. An expired session leaves the labeller on a page that only says
   "Unauthorized" (F1).
1c. Workspace admins can change some accounts' email and password (S1), and
   sign-in has no per-account limit (S2).
1d. No database-side timeouts, and 10 pooled connections with one
   transaction per request (B1, B2).
2. CI does not run on pushes to `staging` (O1).
4. A short Taxomind outage fails every queued AI job (A1).
5. Learning drops labels and leaves a taxonomy stuck in "processing" (A2).
6. Taxomind error bodies, which may contain record text, are stored and logged (A3).
7. The mail webhook defaults to rowsquared's n8n server (A10 / O12).
8. Rate limiting trusts the first `X-Forwarded-For` entry (O4).
9. `BETTER_AUTH_URL` falls back to `http://localhost:3000` (O5).
10. Document the rollback path (O6).
11. The Coolify guide's "Method 2" gives a container that never starts (D1).
12. Patch updates, `better-auth` first (Packages).

## Authentication and authorization

Read by the lead reviewer: `lib/api-auth.ts`, `lib/access.ts`, `lib/auth.ts`,
`proxy.ts`, `lib/cross-site.ts`, the password-link, reset and invitation
code, the member and platform-user logic, and the guard and scoping calls of
every handler. No critical or high finding.

Solid: every one of the 69 route files starts with a session, platform-admin
or workspace guard (the seven without one are the public, token-gated or
rate-limited ones and `health`). Sessions and roles are read from the
database on each request, so bans, role changes and revoked sessions apply at
once. An inaccessible workspace answers 404. Record writes use the same
visibility check as reads. Password and invitation links: 256-bit secret,
stored hashed, compared in constant time, sent in the URL fragment, single
use under a row lock, ended by any password or email change. Forgot-password
answers the same for every address and does the lookup after the response.
The last workspace admin and the last platform admin cannot be removed,
demoted or banned; nobody can suspend, remove or ban themselves. The `next`
parameter of the login page accepts only local paths.

Medium:

- [x] **S1. Workspace admins can still set the name, email and password of
      some accounts.** `mayManageAccount()` in `lib/server/users.ts`
      (account with one membership that never signed in). A workspace admin
      can change such an account's email to an address they control; if a
      platform admin later adds that account to another workspace, the
      first admin holds access to it. This is the open decision in
      `open-items.md`; I agree with its proposal: remove the exception and
      leave profile and password changes to platform admins.
- [x] **S2. Sign-in is limited per client address only, and only in
      production.** `lib/auth.ts:11,36-48`. There is no limit per account,
      so one account can be tried from many addresses without any lock or
      delay; together with O4 the per-address limit can be bypassed too.
      Fix: a second counter per account name (for example 10 failures in 15
      minutes, then a delay), with `allowRequest()` from
      `lib/rate-limit.ts`.
- [x] **S3. Better Auth's admin endpoints that stay enabled bypass the
      app's rules.** `lib/auth.ts:67,72-88` disables create, update,
      set-role, set-password, remove and impersonate, but `/admin/ban-user`,
      `/admin/unban-user`, `/admin/list-users`, `/admin/list-user-sessions`
      and the session revocation calls remain callable by a platform admin
      directly. A ban made there writes no audit entry and skips the
      last-platform-admin check of `lib/server/global-user-admin.ts`
      (reported from reading the configuration; whether the app's own UI
      uses any of them was not traced). Fix: disable the ones the app does
      not call, or drop the plugin if `banned` is only written by the app.

Low:

- [x] S4. `POST /sentences/assign` accepts 10,000 records times 1,000 users
      in one request (`sentences/assign/route.ts:15-21`), which is up to 10
      million rows in one `createMany`. Fix: cap the product (for example
      200,000).
- [x] S5. Every member, labellers included, can list all imports of the
      workspace with file names and row counts
      (`imports/route.ts:7`, `lib/server/imports.ts:7`). The handler also
      returns the raw error message. Fix: admin and supervisor only, or
      limit to imports that contain a visible record; generic error text.
- [x] S6. The custom routes under `/api/auth/` (`forgot-password`,
      `set-password/*`) skip the cross-site check because
      `lib/cross-site.ts:8-13` exempts everything under `/api/auth/` except
      `reset-password`. They need no session, so the effect is small (a
      third-party page can trigger a password mail). Fix: exempt only
      Better Auth's catch-all paths.
- [x] S7. `POST /api/auth/reset-password` checks the current password
      without a rate limit. Someone with a stolen session can try
      passwords. Fix: `allowRequest()` per user.
- [x] S8. Comment PATCH and DELETE read the body without a schema
      (`sentences/[sentenceId]/comments/route.ts:109,155`); a non-string
      `commentId` gives a 500. Fix: zod, as elsewhere.
- [x] S9. When a supervisor is changed to labeller, their reports keep
      pointing at them (`lib/server/memberships.ts`: the reports are cleared
      only on suspension). No access follows from it, because the tree is
      only walked for the supervisor role, but the Users page shows a
      supervisor who is not one (suspected, `validateSupervisor` was not
      read).
- [x] S10. The client-only admin pages (`admin/audit`, and others that are
      `'use client'` pages) have no server-side role check; the API refuses
      the data, so a labeller who opens the URL sees an error state instead
      of "not found". Fix: `requirePageUser(workspaceId, 'admin')` in a
      small server page or an `admin/layout.tsx`.
- [x] S11. Changing one's own password sends no "password changed" notice;
      the password-link path does (`lib/server/accounts.ts`).
- [x] S12. `admin({ defaultRole: 'labeller' })` in `lib/auth.ts:67`: the
      platform role is `admin | user`, so the default names a role that
      does not exist at that level. Harmless (anything but `admin` is a
      user), but misleading.

Decisions rather than defects: sessions use Better Auth's default lifetime
(7 days, extended while in use) with no shorter idle limit for admins, and
there is no second factor (already in open items).

## Database and workspace isolation

Read: `lib/workspace/db.ts`, `lib/prisma.ts`, the row-security part of the
migrations, `scripts/db-runtime-role.ts`, `scripts/start.sh`, the indexes and
delete rules of `prisma/schema.prisma`, every unsafe raw SQL call, import
deletion and workspace deletion. No critical or high finding.

Solid: all 24 workspace data tables have row security with a policy for
reads and writes; the four without it (`WorkspaceMembership`,
`WorkspaceInvitation`, `OutgoingMail`, `AIEndpointGrant`) are the documented
control-plane tables. The workspace is set per transaction
(`set_config(..., true)`), so it cannot leak to the next user of a pooled
connection, and with no workspace set the policies show nothing. The runtime
role is created without superuser, owner or bypass rights, and production
refuses to start as the schema owner. The Prisma extension adds the workspace
filter as a second layer. No raw SQL is built from user input: every
`...RawUnsafe` call takes its identifiers from a static list and passes
values as parameters. Workspace deletion uses a child-first allowlist inside
one transaction with its audit entry.

Medium:

- [x] **B1. No statement or idle-transaction timeout on the database
      side.** Nothing sets `statement_timeout`,
      `idle_in_transaction_session_timeout` or `lock_timeout`
      (`lib/prisma.ts`, `scripts/db-runtime-role.ts`, Compose). Prisma's
      transaction timeout ends the client side only; a stuck query or a
      crashed request can keep a connection and its locks. Fix: in
      `db-runtime-role.ts`, `ALTER ROLE ... SET
      idle_in_transaction_session_timeout = '5min'` and a
      `statement_timeout` above the longest import.
- [x] **B2. Every workspace request holds one of 10 pooled connections for
      its whole duration.** `workspaceRoute` wraps each handler, reads
      included, in one transaction (`lib/api-auth.ts:216`), and the pool
      default is 10 (`lib/prisma.ts:10`). The eleventh concurrent request
      waits up to 15 s and then fails. An export, an import or a slow
      progress query takes a slot for minutes. Some modules also use the
      global client next to the workspace transaction
      (`lib/user-rules.ts`, `lib/server/invitations.ts`,
      `lib/server/member-import.ts`, `lib/ai-connections.ts`); where that
      happens inside a request, the request needs two connections at once
      (not traced call by call). Fix: raise the default to about 20, state
      the expected number of concurrent users in DEPLOYMENT.md, and run the
      progress benchmark from open items with labelling writes before the
      release.
- [x] **B3. Deleting an import deletes its labels, comments, double
      annotation rounds and labelling history without a server-side
      guard.** `imports/[id]/route.ts`. The handler does not check or report
      how many labelled records go with it and needs no confirmation
      parameter (replacing a taxonomy needs `confirmOrphans=true`). The
      labelling history rows cascade, so past progress numbers shrink. It
      also loads every record id and passes them as one `IN` list, which
      for an import above about 32,000 records may exceed the parameter
      limit of the PostgreSQL protocol (suspected, depends on Prisma's
      chunking), and it returns the raw error message. Fix: delete through
      the relation (`sentence: { importId }`), return the number of
      labelled records in a preview, and require a confirmation flag when
      it is above zero.

Low:

- [x] B4. Row security is enabled, not forced, so it binds only a role that
      does not own the tables. That is the design, but
      `ALLOW_OWNER_RUNTIME=true` turns workspace isolation at the database
      level off with only a start-up warning. Fix: report the mode in
      `/api/health` (for example `rowSecurity: false`) so monitoring sees
      it.
- [x] B5. The second layer does not cover everything: related rows loaded
      with `include` and raw SQL are not filtered by the Prisma extension,
      and development, tests as superuser and the e2e suite never run under
      row security. The integration and smoke jobs do. Fix: run the e2e
      suite as the runtime role too (see Tests).
- [x] B6. `SentenceAnnotation` has no index that starts with `taxonomyId`
      (`@@index([nodeCode])`, `[createdById, createdAt]`,
      `[workspaceId, createdAt]`). The learning selection and the
      orphan check before a taxonomy replace filter by taxonomy
      (suspected; not measured).
- [x] B7. The runtime role can read and write `Account` (password hashes),
      `Session` and `Verification`. That is needed, and no injectable query
      was found, but it means any future SQL injection is an account
      takeover; keep the lint rule against unsafe raw SQL strict.
## Labelling, import and export

Read: the single save handler, `lib/server/bulk-label.ts`,
`lib/annotation-status.ts`, the record import handler, `lib/csv.ts`,
`lib/upload.ts`, the kappa classes in `lib/double-annotation.ts` and the
structure of `lib/export-csv.ts`. See the coverage table for what was not
read. No critical or high finding.

Solid: both save paths validate the label path, lock the records in id
order and share one set of status rules; AI suggestions never complete a
record; a repeated save is counted once in the labelling history. Codes stay
strings from the CSV parser to the export. The export streams in batches of
1,000 and refuses colliding column names. Formula neutralising touches only
free-text columns, so codes such as `-99` or `0110` are exported unchanged.
The kappa calculation is correct for two ratings per record with pooled
category shares, and returns nothing when it is undefined.

Medium:

- [x] **L1. A CSV saved by Excel in a non-UTF-8 encoding is imported with
      broken characters, without any warning.**
      `lib/upload.ts:18` decodes the file as UTF-8 (`entry.text()`); bytes
      of a Windows-1252 file (the default of Excel's plain "CSV" format)
      become the replacement character, so "Bäcker" is stored as "B�cker"
      and the dry run reports success. Fix: decode with
      `new TextDecoder('utf-8', { fatal: true })` and refuse the file with
      "Save the file as CSV UTF-8", or detect and convert Windows-1252.
- [x] **L2. Semicolon-separated CSV files are refused with a confusing
      message.** `sentences/import/route.ts:40-48` parses with the default
      comma only. Excel with German (and most European) regional settings
      writes semicolons, so the whole header becomes one column and the
      answer is "Invalid columns found: id;field_text". Fix: detect the
      delimiter from the header line (`delimiter: [',', ';', '\t']` in
      csv-parse) for records, taxonomies and the member import alike.
- [x] **L3. Two people saving the same record overwrite each other
      silently.** `lib/annotation-status.ts` (`lockSentences`): saves run
      one after the other and the last one wins; the save does not say
      which state it was based on. A supervisor correcting a record while
      the labeller still has it open loses the correction on the
      labeller's next save, and bulk labelling replaces existing labels of
      other people the same way. Fix: send the record's `lastEditedAt` with
      the save and answer 409 "changed by someone else since you opened
      it" when it differs; in the bulk dialog, state how many selected
      records already have labels for the taxonomy.
- [x] **L4. A handler that answers with an error after it has written
      something still commits what it wrote.** `workspaceRoute`
      (`lib/api-auth.ts:216`) commits whenever the handler returns, and
      most handlers catch their errors and return a 4xx/5xx response
      themselves. A database error aborts the transaction, so that case is
      safe; an application error raised after the first write is not. I
      found no place where this happens today in the two save paths (their
      checks run before their writes), so this is a structural risk, not a
      present bug. Fix: let `workspaceRoute` roll back when the response
      status is 500 or above, or throw from handlers and map errors to
      responses outside the transaction.
- [x] **L5. A bulk save issues one UPDATE per record inside the default 60
      second transaction.** `lib/server/bulk-label.ts` (the loop over
      `current`, up to 10,000 records). On a slow database connection the
      transaction times out and nothing is saved. Fix: group the records
      by resulting status and use one `updateMany` per group.

Low:

- [x] L6. The record import has no row limit and checks existing ids with
      one `IN` list of every id (`sentences/import/route.ts`, "Check for
      existing IDs"). A 50 MB file can hold several hundred thousand rows,
      all in memory and in one transaction of up to 30 minutes on one
      pooled connection (see B2); the id check may exceed the parameter
      limit above about 32,000 ids (suspected, as B3). Fix: check ids in
      chunks of 10,000 and state a row limit (for example 200,000) in the
      UI and the handler.
- [x] L7. Rows whose first field is empty are imported as empty records
      (`field1` becomes `''`). Fix: report them as row errors, or as a
      warning with a count in the dry run.
- [x] L8. A taxonomy that is not active can still receive labels: the save
      handlers look the taxonomy up by key without checking `isActive`.
- [x] L9. When a taxonomy is activated later, records that were complete
      stay `submitted` until someone touches them; the next comment or flag
      then moves them back to `pending` (`decideStatus`). The queue counts
      are wrong in between (suspected: the taxonomy update handler was not
      read; it may recompute).
- [x] L10. `FORMULA_START` in `lib/csv.ts` does not catch a formula after
      leading spaces (" =1+1"); some spreadsheet programs trim them.
- [x] L11. User-facing text still says "sentence": "Successfully labeled N
      sentence(s)" (`lib/server/bulk-label.ts`), "Sentence not found", "No
      sentence IDs provided". The product calls them records, and the
      spelling elsewhere is "labelled".

## Frontend and UX

Read in full: the labelling screen, the double annotation panel and start
dialog. Read for selection, paging and refresh: the queue page. Checked by
pattern search across all of `app/` and `components/`: error pages, session
expiry, leftovers, conventions, wording, design rules. Nothing was opened in
a browser, so layout on narrow screens, focus order and visual glitches are
not covered.

Solid in what was checked: no `dangerouslySetInnerHTML` except the nonce
script in `app/layout.tsx`; markdown in tooltips is rendered without raw
HTML; no `setInterval` polling, `console.log`, TODO markers, `font-bold` or
`bg-opacity-*` in client code; failed saves on the labelling screen show a
toast and keep the selection.

Medium:

- [x] **F1. Nothing handles an expired session in the client.**
      `lib/query/fetch.ts` turns a 401 into an error like any other, and no
      component reacts to it. A labeller whose session ended gets a toast
      or an error panel reading "Unauthorized" and stays on the page; only
      a page navigation reaches the sign-in redirect in `proxy.ts`. Fix: in
      `components/QueryProvider.tsx`, give the query and mutation caches an
      `onError` that, for `HttpError` 401, shows "Your session has ended"
      with a sign-in link that opens `/login?next=<current page>` (a new
      tab keeps unsaved selections).
- [ ] **F2. No warning before leaving a record with unsaved selections.**
      There is no `beforeunload` handler or navigation guard anywhere in
      `app/` or `components/`. A reload, the back button or a click in the
      sidebar discards the labels chosen but not yet submitted (how
      previous/next behave was not read). Fix: a guard on the labelling
      screen while the selection differs from the saved labels.
- [x] **F3. Every opened record sends an extra "warm-up" save request.**
      `components/labeling/LabelingScreen.tsx:144-155` posts to the
      annotations endpoint with `x-warmup: 1` "so the first submit is not
      delayed by compilation". Compilation on first use exists only in
      development; in production this is one extra authenticated request
      and one database transaction per record view, which also takes a
      pooled connection (B2). Fix: send it only when
      `process.env.NODE_ENV === 'development'`, or remove it and the
      header check in the handler.

Low:

- [x] **F8. Single-key shortcuts act at once and cannot be undone.**
      `components/labeling/LabelingScreen.tsx` (keyboard handler): `s`
      skips the record and moves to the next one, `f` toggles the flag,
      `u` sets "unknown". A key pressed while the focus is not in the
      search field (for example after clicking a label) skips a record
      without notice. A review decision has an undo toast; a skip has
      none. Fix: an "Skipped. Undo" toast, as for decisions. The same key
      lets a manager skip a record that is in double annotation (DA5).
- [ ] **F9. There is no "select all matching records".**
      `QueuePageClient.tsx` selects the rows of the current page only; the
      way to select more is the page size "all", which loads up to 10,000
      records with their labels into the page (Q4) and stops there. A
      workspace with 50,000 records needs five rounds to assign them.
      Fix: "Select all N matching" that sends the filter instead of the
      ids, resolved on the server in chunks.

Seen in a running browser (local demo data, signed in as the demo
supervisor; queue and record screen at 375, 768 and 1366 pixels wide; no
console errors on either screen):

- [x] **F12 (medium). On a laptop screen the review panel leaves no room
      for the taxonomy browser.** At 1366 by 768 the double annotation
      panel (status line, comparison table, three decision cards, note
      field, "Stop double annotation") fills the right half; below it only
      the "No labels selected" strip and the action bar are visible. A
      reviewer who picks "Other label" has to scroll inside the pane to
      find the browser. This is the practical reason for DS4.
- [x] **F13 (medium). The sidebar does not collapse on narrow screens.**
      At 375 pixels it keeps about 255 pixels, so the queue gets about 120:
      the filter chips stack one per line and the table is cut off. At 768
      pixels the record screen's comparison table is cut off after column
      A and the page title is covered by the "Back to queue" button.
      Decide whether phones and tablets are supported; if yes, collapse
      the sidebar below about 1024 pixels by default, if no, say so in the
      README.
- [x] F14 (low). There is no "skip to content" link: from the top of the
      page, the keyboard focus goes through every sidebar entry before it
      reaches the page. The record screen has two `h1` elements.
- [x] F15 (low). A record opened by its link shows "Sentence navigation
      unavailable" at the bottom. Hide the previous/next area when there
      is no list, or say "Opened from a link".
- [x] F16 (low). The chip "Needs another person · 0" is red also when the
      count is zero.
- F3 confirmed: opening a record sent the warm-up POST to the annotations
  endpoint (twice in development).

Low:

- [ ] F10. The interface still says "sentence" in about 25 places, against
      "record" everywhere else: the sidebar entry "Sentences", "No
      sentences found", "N sentences selected", "Search sentences...",
      "Previous sentence" / "Next sentence", "Sentence not found", the
      bulk and assignment dialogs, the import deletion message. The
      spelling is mixed too: "labeling" 26 times and "Labelling" /
      "labelled" in the newer double annotation and server texts. Choose
      one of each and replace.
- [x] F11. The sign-in card uses `rounded-lg shadow-lg`
      (`components/AuthCard.tsx:16`), against the design rule "flat
      panels, shadow only on floating layers", and
      `app/reset-password/page.tsx:59` repeats the same markup instead of
      using `AuthCard`.
- [x] F4. Only `app/error.tsx` exists. There is no `not-found.tsx` (an
      unknown URL shows Next's bare 404 without the app's layout), no
      `global-error.tsx` (an error in the root layout shows a blank page)
      and no `loading.tsx`. `error.tsx` prints `error.message` as is. Fix:
      add the two pages and show a fixed text with the error digest.
- [x] F5. Three places use the browser's `confirm()` / `alert()` instead of
      `Modal`: `admin/ai-jobs/AIJobsClient.tsx:140,151`,
      `app/workspaces/AIEndpointsPanel.tsx:73` and, for the destructive
      "replace the taxonomy anyway" step,
      `components/taxonomy-admin/EditTaxonomyDialog.tsx:52`.
- [ ] F6. About 35 calls in client components use `fetch` directly instead
      of `fetchJson` and TanStack Query, against the convention in
      AGENTS.md: the taxonomy dialogs, `SentenceAdminClient.tsx` (which
      loads the import list by hand), `AssignmentModal.tsx`,
      `AISettingsClient.tsx`, `AIEndpointsPanel.tsx`,
      `CreateWorkspaceForm.tsx`, `MemberImportModal.tsx`,
      `PendingInvitations.tsx`, the comment requests in
      `LabelingScreen.tsx`. Each handles errors its own way, and F1 cannot
      be fixed in one place until they go through `fetchJson`.
- [x] F7. The pages can be indexed: `app/layout.tsx` sets only a title, and
      there is no `robots.txt`. A self-hosted internal tool should send
      `robots: { index: false, follow: false }`. The title reads
      "classiflow – labeling tool" while the interface writes "labelling".

## Queue, taxonomy CSV, progress dates, analysis export

Read in full: `lib/server/sentences.ts`, `lib/taxonomy-csv.ts`,
`lib/reporting-dates.ts`; read for scoping and structure:
`lib/server/progress.ts`, `lib/export-double.ts`, `lib/zip.ts`.

Solid: the list and the counts are built from the same filter function, so
they agree; ordering has a unique tie-breaker, and a page beyond the end is
clamped; every filter stays inside the caller's visibility; participants'
filters and rows use their own part only. The taxonomy CSV rules are
complete (unique ids, reserved unknown codes refused, parent exactly one
level up, which rules out cycles) and shared by all four handlers. Progress
and the analysis export apply the team scope, and supervisors' analysis
leaves out their own parts. Day and week boundaries handle daylight-saving
changes correctly.

- [ ] **Q1 (medium, simplification). The status `escalated` is half
      built.** The save endpoint accepts it and the progress workload card
      knows it, but no labelling screen offers it, the queue's counts have
      no bucket for it (total is then more than pending + submitted +
      skipped) and participants' status filters ignore it. Either remove it
      from the API schema and the card (keep the enum value in the
      database), or finish it; I would remove it, since flags and comments
      already cover "needs attention".
- [ ] Q2 (low). The queue counts run the filter two to three times and
      eleven count queries per request (`getQueueStats()`); with a search
      term the text search function runs each time. For callers without a
      double annotation part, one `groupBy status` gives the four status
      numbers. Not measured.
- [ ] Q3 (low). The "last edited" date filter uses the server's time zone
      (`setHours(0,0,0,0)` in `queueWhere()`), which is UTC in the
      container, so a record edited at 00:30 local time is found under the
      previous day. An invalid date or a non-numeric `level` reaches Prisma
      and gives a 500 (suspected: the route may validate first).
- [ ] Q4 (low). The page size goes up to 10,000 records ("all") with labels,
      assignments and AI suggestions for each. Fine for a selection of ids,
      heavy as a rendered page; see the frontend findings.
- [x] Q5 (low). The taxonomy CSV has the same two Excel problems as the
      record import (L1 encoding, L2 semicolons), and no limit on the
      number of nodes or the length of a label.
- [x] Q6 (low). Progress days are UTC days. A person in Berlin who labels
      between midnight and 01:00 (02:00 in summer) is counted on the
      previous day. State "UTC" next to the date range, or pass the
      browser's zone (the helpers already take one).

## Progress reports and analysis export (SQL and row logic)

Read in full: `lib/server/progress.ts` and the pairs export in
`lib/export-double.ts`. No defect found in the analysis export: the answers
"as compared" are selected correctly (created before the comparison, not
superseded before it), the final source (A, B, other, single) is derived
from them, text columns are neutralised and codes are not.

- [ ] P1 (low). A supervisor's past numbers change when assignments change.
      The activity counts include only records that are assigned to a
      visible member today (`activityWhere()` with `assignedTo()`). When a
      record is unassigned later (member removed with "unassign open
      work", or other labellers lose access at the start of double
      annotation), the labelling done on it disappears from the
      supervisor's history; admins are not affected. Fix: count by the
      person who labelled, without the assignment condition, or state the
      rule under the chart.
- [x] P2 (low). The labeller's progress cards and queue counts can
      disagree. The queue takes the labeller's own part from a round in any
      state; the progress cards only from an active round
      (`workloadStatus()`, `r.status = 'active'`). After a round was
      stopped, the cards show the record's status, which can reflect the
      other person's labels.
- [x] P3 (low). "Agreement by labeller" is grouped by display name
      (`summarizePairs()`): two people with the same name are merged, and
      all removed accounts become one "Former member". Group by user id.
- [ ] P4 (low). The double annotation section loads every compared pair of
      the period into memory, with four sub-queries per pair, on each
      overview request. Fine at today's volumes; covered by the benchmark
      in open items.
- [ ] P5 (low, simplification). The time zone is fixed to `'UTC'` in
      `reportContext()`, but `lib/reporting-dates.ts`,
      `lib/progress-projection.ts` and `components/progress/format.ts`
      still carry the zone and about 60 lines of daylight-saving handling.
      Either pass the browser's zone (which fixes Q6) or remove the
      parameter.
- [x] P6 (low). The two exports write unknown codes differently: the
      records export writes `UNKNOWN` (`exportCode()` in
      `lib/export-csv.ts:194`), the analysis files write the raw codes
      (`-9`, `-99`). Someone joining the two files gets mismatches. Use one
      form, or say so on the export page.

## Admin screens

Read: the records, export, AI jobs and AI settings screens; the Users
screens (list, editor, add user, workspace access) for data and error
handling. The Users screens follow the conventions throughout (one fetch
helper, buttons disabled while saving, alerts, typed confirmation for
deletion); nothing to report there.

- [x] **AD1 (medium). The record import commits without showing the
      preview.** `admin/sentences/SentenceAdminClient.tsx`
      (`handleSentenceUpload`): one click on "Upload" runs the dry run and,
      when it passes, the real import straight after. The person never
      sees the row count and the detected field and support columns that
      the dry run returns, and the file is uploaded twice. Row errors (up
      to 200) are joined into one line. Fix: show the dry-run summary with
      "Import N records" as a second step, and list errors one per line.
      The taxonomy dialogs already work this way.
- [x] AD2 (low). The records admin screen is the one screen still in the
      old style: page title and sidebar entry "Sentences", an emoji in the
      heading, "Successfully imported N sentences!", "CSV File", raw
      `fetch` with hand-kept loading state, `rounded-lg` and
      `border-gray-300` controls. A failed load of the import list shows
      "No imports yet" (the error goes to the console only).
      Import history now shows a load error and a Retry action.
- [x] AD3 (low). The AI jobs table shows a progress bar of 0, 50 or 100
      percent for learning and taxonomy sync jobs, which have no progress
      information (`getProgress()` in `AIJobsClient.tsx`). Show "Running"
      without a bar. The status badges are built by hand instead of
      `badgeClass`, table headers use `text-gray-500` (below the contrast
      rule), and the page and status filter are not kept in the URL.
      The progress display has been fixed.
- [ ] AD4 (low). Downloads are plain links. When the export fails (for
      example two columns with the same name), the browser saves or shows
      a JSON error instead of a message on the page.

## Double annotation

Read in full: `docs/double-annotation.md`, `lib/double-annotation.ts`,
`lib/server/double-annotation.ts`, the three route handlers,
`components/labeling/DoublePanel.tsx` and the start dialog
(`components/queue/DoubleAnnotationPanel.tsx`). The participation rules hold
in every path read: a participant's save only adds a revision of their own
answer, reviewers cannot decide records they labelled, supervisors need both
labellers in their team, and one active round per record is enforced by a
unique index.

Defects:

- [x] **DA1 (medium). "Undo decision" can confirm a result nobody agreed
      on.** `reopenReview()` in `lib/server/double-annotation.ts:576-603`
      restores the state from the frozen first comparison
      (`outcome.matched ? 'agreed' : 'disagreed'`). Example: A and B both
      answer 2221 (agreed, `matched = true`); B changes the answer to 2222,
      so the taxonomy needs review; the reviewer picks 2222; the reviewer
      clicks "Undo decision". The state becomes `agreed` again with A's
      2221 as the confirmed result, the round completes and the record is
      `submitted`, although the two current answers differ. Fix: in
      `reopenReview()` compare the two current answers (or return to
      `disagreed` whenever `revisedAfterCompare` is set). Read from the
      code, not run.
- [x] **DA2 (medium). Starting double annotation for a large selection can
      time out.** The start accepts 10,000 records
      (`sentences/double-annotation/route.ts:27`) and `startRounds()`
      issues five to six statements per record plus one delete per record,
      all inside the default 60-second transaction. Fix: a route timeout
      as for imports, batched `createMany` calls, or a lower limit (for
      example 2,000) stated in the dialog. Not measured.
- [ ] DA3 (low). A participant who removes their flag also removes a
      manager's flag. `setParticipantFlags()` (`:196-224`) copies the part's
      flag onto the record and clears the record's flag when no part is
      flagged, without knowing whether a manager set it. Fix: keep the two
      apart and show managers "flagged" when the record or any part is.
- [x] DA4 (low). The preview of "hand over" counts parts that the commit
      then skips: the dry run checks only `status === 'submitted'`
      (`commands/route.ts`), the commit also refuses parts with a partial
      answer (`reassignTask()`).
- [x] DA5 (low). A manager can set a record in an active round to skipped
      or escalated (`annotations/route.ts`, "a manager's record-level
      decision"); the next save by a participant sets it back to pending or
      submitted.
- [ ] DA6 (low). While two answers disagree, a changed answer of the first
      person is not copied to the record's labels, although the rule is
      "the first answer is the result while disagreeing"
      (`saveTaskAnswer()`, the branch after the comparison).
- [ ] DA7 (low). A disagreement that disappears because one person changed
      their answer to the other's still waits for a review. Show "the
      answers now match" with one button to confirm, or confirm it
      automatically.

Simplifications (product decisions; each removes code and explanation):

- [ ] **DS1. One vocabulary for the state.** Today there are six:
      `OutcomeState` (5 values), `RoundSummary` (3), the queue row state
      (5: waiting, review, agreed, resolved, accepted), the per-taxonomy
      export status (7), the record export status (5) and the filter values
      (any, review, waiting, gap, done), with labels that do not line up
      ("reviewed" is shown as "Resolved" in one place and "Decided" in
      another; "accepted_single" as "Single label accepted"). Use the four
      words the chips already show everywhere a person reads them:
      Waiting, Needs review, Needs another person, Confirmed, with the way
      it was confirmed (agreed, decided, single label) as a detail.
- [ ] **DS2. Lock a confirmed result instead of tracking drift.** Today a
      labeller without a part, or a person whose part was "given back as
      ordinary work", can overwrite a confirmed result; the export then
      reports it as `single`, and `resultCodes`, the drift branch in
      `taxonomyStatus()`, `scripts/sql/double-annotation-drift.sql` and the
      "release" command exist to handle that. Simpler rule: a confirmed
      result changes only through a manager's "Change confirmed result".
      Then "release" only needs to show the person the result, and the
      drift handling can go. The cost: such a labeller gets "this label is
      confirmed" on a save, which tells them the record was double
      annotated.
- [ ] **DS3. One start form instead of two modes.** The server already
      decides per record whether existing labels count as the first answer
      (`planStart()`); the mode switch in the dialog only decides whether a
      first person is asked for. Show two fields: "Second person" (default
      automatic) and "First person (only for records nobody labelled
      yet)", and keep the preview as it is.
- [ ] **DS4. Fewer buttons on the record screen.** The panel can show up to
      five status lines, the comparison, the decision form and three
      commands at once. Keep the comparison and the decision; move
      "Accept single label", "Hand over a part" and "Stop double
      annotation" into one "More" menu (Radix `DropdownMenu`), and the
      history lines (handed over, given back, changed after comparison)
      behind one "History" disclosure.
- [x] **DS5. Decide blind review once.** The panel has a per-browser
      "Hide names while deciding" checkbox; open items lists a workspace
      setting for the same thing. Simplest: always show "Answer A / Answer
      B" while a disagreement is open and the names after the decision,
      with no setting.
- [ ] DS6. Small code leftovers: the deprecated alias `ActiveRound`; the
      `hidden` view mode that the comments call "not normally reachable"
      (with `recordLabelingAccess()` built on it); hard-coded colours
      `#F7F3B3` / `#4d470b` in `DoublePanel.tsx` instead of theme tokens;
      the preview's query key built by hand with every record id joined
      into one string instead of `lib/query/keys.ts`.

## AI jobs, mail, logging, audit log

No path was found by which one workspace reads another workspace's AI
credential or redirects a job to another endpoint.

High:

- [x] **A1. A short Taxomind outage fails the whole queued backlog.**
      `lib/ai-job-monitor.ts:482-501`, `lib/ai-labeling.ts:66-77`. A failed
      start request (connection refused, 502/503, timeout) marks the job
      failed, then admits the next pending job, which fails the same way.
      Example: 500 queued jobs and a 30-second Taxomind restart leave 500
      failed jobs to re-create by hand. Fix: treat network errors and 5xx on
      start as retryable with backoff and a cap; fail only on 4xx and
      contract errors; pause admission for an endpoint after repeated start
      failures. Reported.
- [x] **A2. Learning silently drops human labels and can stay "processing".**
      `app/api/workspaces/[workspaceId]/ai-labeling/learn/route.ts:59-61,124-132`,
      `lib/ai-job-monitor.ts:608-633`. `lastLearningAt` is set to the
      completion time, but the next run selects labels with
      `updatedAt > lastLearningAt`, so labels saved while a run is in
      progress are never sent. If one batch of a run fails and the last one
      completes, the date still advances and the failed batch is never
      retried. The new-labels counter is zeroed at creation and not restored
      on failure or cancel. Nothing writes `lastLearningStatus` on failure or
      cancel, so it stays `processing` and the page polls forever. Fix: store
      the selection cut-off on the job and write it as `lastLearningAt` only
      when every job of the run completed; otherwise restore the counter and
      set the status to failed. Reported.
- [x] **A3. Taxomind error bodies are copied into job rows, API responses and
      logs.** `lib/ai-labeling.ts:74-77`, `lib/ai-job-monitor.ts:486-489,569`,
      shown by `lib/server/ai-jobs.ts:53`. The whole non-2xx body becomes the
      error message. Log redaction matches key names only, not text inside a
      message. FastAPI 422 responses normally echo the offending input, which
      here is the record text (suspected, not observed). The body has no size
      limit. Fix: keep the status code and a truncated `detail[].msg/loc`
      (about 300 characters) only. Leak path reported.

Medium:

- [x] **A4. A brief database error permanently fails a running job.**
      `lib/ai-job-monitor.ts:515-516` sit outside the retry `try` at `:521`.
      A pool timeout during a poll marks the job failed while Taxomind
      completes it; the results are lost. Fix: move both calls inside the
      retry block.
- [x] **A5. The job lease is shorter than the work it covers.**
      `lib/ai-job-monitor.ts:87,89,597-601`, `lib/ai-labeling.ts:27`,
      `docker-compose.yml:85`. With the Compose poll interval of 5 s the
      lease is 70 s, but a start request may take 180 s and backoff sleeps
      reach 300 s. With two instances or during a rolling deploy another
      instance takes the job and sends it again (learning has no idempotency
      key, so it trains twice). Fix: renew the lease on a timer while the
      monitor is alive.
- [x] **A6. There is no real maximum job age.**
      `lib/ai-job-monitor.ts:511,581-590`, `docker-compose.yml:86`,
      `lib/constants.ts:27`. The timeout clock starts per monitor run, so
      every restart resets it. The Compose default is 10 minutes (code
      default 5 hours): a labelling job that needs 11 minutes is marked
      failed while Taxomind keeps computing. The timeout does not cancel the
      remote job. Fix: measure against the job row's start time, cancel
      remotely on timeout, align the two defaults.
- [ ] **A7. A crash or timeout between the start request and saving
      `externalJobId` duplicates the job.** `lib/ai-job-monitor.ts:450-458`,
      `lib/server/ai-jobs.ts:142-146`. Also: cancelling during the in-flight
      start request sends no remote cancel. Fix: send the job id as an
      idempotency key on all three requests (needs Taxomind support, already
      in open items for `/learn`); after start, cancel remotely if the job is
      no longer `processing`.
- [x] **A8. A failing result import is retried on every poll until the
      timeout.** `lib/ai-job-monitor.ts:537-557,580-586,667-682`. Results are
      written with two statements per record in one transaction (120 s
      limit), while the workspace batch size may be up to 100,000
      (`ai-settings/route.ts:22`). Fix: one `deleteMany` plus chunked
      `createMany`; fail the job after N import attempts; lower the batch
      size ceiling.
- [x] **A9. AI codes are checked for existence only, not for level or path.**
      `lib/ai-job-monitor.ts:655-668`. A level-3 code returned at level 1, or
      a level-2 code that is not a child of the level-1 code, is stored and
      shown as a suggestion. Fix: check level, `maxDepth` and the parent
      chain; drop the record otherwise.
- [x] **A10. Temporary passwords and password links pass through n8n in
      clear, and the webhook URL defaults to rowsquared's server.**
      `lib/mail/config.ts:27`, `lib/mail/n8n.ts:41-45`,
      `lib/mail/templates.ts:155`, `docker-compose.yml:68`. Someone who
      self-hosts and sets only the secret posts account mail to
      `n8n.rowsquared.com`. n8n stores execution data by default
      (suspected). Fix: no default URL; turn off execution-data saving on the
      workflow; prefer invitation links over mailed passwords.
      The app requires an explicit webhook URL. On 16 November 2026 the
      maintainer confirmed that the hosted webhook works and that n8n does
      not retain its execution data.
- [x] **A11. Job admission has no per-endpoint limit.**
      `prisma/migrations/20261022110000_per_workspace_ai/migration.sql:243-255`.
      Hung jobs on one endpoint can fill the deployment ceiling and block
      workspaces on a healthy endpoint.
- [ ] **A12. Unbounded job counts and in-memory lists.**
      `ai-labeling/jobs/route.ts:60-114`, `ai-settings/route.ts:22`,
      `lib/server/ai-jobs.ts:59-104`. Batch size 1 is allowed, so one request
      can create one job per record. Nothing rejects records that already
      have an active job for the taxonomy, so a double click queues
      everything twice. `listAIJobs` loads every job of the workspace and
      pages in memory; `listActiveAIJobs` is polled from every admin page
      header. Fix: batch size 10 to 5,000, a cap on jobs per request, reject
      overlap, page in SQL.

Low:

- [ ] A13. Platform admins can approve any URL as an AI endpoint (`http://`,
      loopback, private ranges, `169.254.169.254`):
      `lib/ai-connections.ts:82-93`. Workspace admins cannot enter URLs.
      Fix: require https outside development and reject private addresses
      unless an environment flag allows them.
- [x] A14. Cancel can overwrite a job that completed in between:
      `lib/server/ai-jobs.ts:117-140`. Fix: conditional `updateMany`.
- [x] A15. No size limit on Taxomind responses: `lib/ai-labeling.ts:84-91`.
- [x] A16. The GCM tag length is not pinned: `lib/ai-credentials.ts:87-89`.
      Fix: `{ authTagLength: 16 }` on both sides.
- [ ] A17. Mail is never retried: `lib/mail/outbox.ts:100-120,366-369`,
      `lib/mail/n8n.ts:22-26`. An n8n failure during a CSV member import
      leaves every invitation unsent until an admin resends. A resend
      replaces the invitation token before sending (`:146-153`), so a failed
      resend invalidates the link the person already has. Long batches are
      wrongly marked "server stopped while sending".
- [x] A18. The audit log can be changed and has gaps.
      `scripts/db-runtime-role.ts:58` grants UPDATE and DELETE on
      `AuditLog`; `app_prune_audit_log(before)` accepts any timestamp, so
      the runtime role can delete every audit row. Not audited: sign-ins and
      failed sign-ins, AI results stored, job failures. Platform events
      (endpoint approvals, account changes, workspace deletion) have no page
      or API to read them. Fix: revoke UPDATE/DELETE, clamp the prune
      function to a minimum age, add a platform audit view, audit sign-ins.
- [x] A19. Error messages returned to clients may carry values (Prisma and
      Postgres messages): `ai-labeling/jobs/route.ts:133-135,174-176`,
      `learn/route.ts:160-162`, `jobs/[jobId]/route.ts:26` and eight places
      in the taxonomy routes. A zod parse error returns 500 instead of 400
      there. Fix: generic text with the request ID.
- [x] A20. One health endpoint serves liveness and readiness:
      `app/api/health/route.ts:9-31`. Three failed database probes mark the
      container unhealthy. Fix: a separate liveness endpoint without the
      database.
- [x] A21. Numeric environment values are parsed without guards:
      `lib/constants.ts:23-27`. `AI_LABELING_BATCH_SIZE=0` makes the batching
      loop at `jobs/route.ts:75` never end; a non-numeric poll interval gives
      a 1 ms poll loop.
- [x] A22. A well-formed client `x-request-id` is trusted
      (`lib/request-id.ts:20`), so a caller chooses the ID written to audit
      rows, unless the reverse proxy strips it.
- [x] A23. The plain-text mail body is built but never sent
      (`lib/mail/n8n.ts:44`).
- [x] A24. Traces are not flushed on shutdown (`lib/telemetry.ts:13-22`).
- [x] A25. A new AI credential is not tested when saved
      (`ai-settings/connection/route.ts:23-43`); a wrong token shows up only
      as a failed job.

Solid in this area: credential encryption (AES-256-GCM, random nonce, bound
to workspace and connection, key rotation, never returned or logged);
redirects refused and timeouts set on both HTTP clients; result import is
atomic and only for the job's own records; AI output never counts as human
completion; mail values are HTML-escaped and tokens are stored hashed;
leases are released on shutdown; no `console.*` in server code.

## Operations, CI and deployment

High:

- [x] **O1. Pushes to `staging` run no CI.** `.github/workflows/ci.yml:14-19`,
      `COOLIFY_DEPLOYMENT.md:464-470`. Staging deploys on push and is the
      only source of `main`; CI before promotion is a manual run. The `main`
      ruleset requires only `smoke` and `checks`; `e2e` is an open item and
      `integration` is not listed as required. Fix: add `staging` back to
      `push.branches` and require all four jobs.
      The GitHub ruleset was checked and already requires all four jobs.
Medium:

- [ ] O3. The image CI tests and scans is not the one deployed; Coolify
      rebuilds from source on the production host, next to the live app and
      database, with no memory limit (`ci.yml:30-51`,
      `docker-compose.yml:119-121`). `apk add` in `Dockerfile:4,41` is
      unpinned. Fix: build once in CI and deploy by digest, or at least set
      limits.
- [x] **O4. Rate limiting trusts the first `X-Forwarded-For` entry.**
      `lib/rate-limit.ts:24-27`, `lib/auth.ts:36-48`. Behind a proxy that
      appends to the header, an attacker picks their own rate-limit key and
      bypasses the sign-in and forgot-password limits; with no header all
      clients share one key and one person can lock password links for
      everyone. Fix: a trusted-proxy count setting.
- [x] **O5. `BETTER_AUTH_URL` falls back to `http://localhost:3000`.**
      `docker-compose.yml:50`, `lib/auth.ts:20`. A forgotten value gives
      failing sign-ins; an `http://` value gives cookies without the Secure
      flag. Fix: `${BETTER_AUTH_URL:?}` and a start-up check for `https://`
      in production.
- [x] **O6. Document the rollback path.** `COOLIFY_DEPLOYMENT.md:516-520`,
      `scripts/start.sh:25`. Migrations are forward-only and run at container
      start; "redeploy the previous deployment" runs old code on the new
      schema. Fix: write down the rule (additive migrations only, drops one
      release later).
      See [Upgrades and rollbacks](../../../DEPLOYMENT.md#upgrades-and-rollbacks).
- [x] O8. Each deploy recreates the container and runs migrations first, so
      there is a short outage per release and in-flight saves are lost
      (suspected, depends on Coolify). Nothing documents it.
- [ ] O9. No log rotation options and no memory/CPU limits in
      `docker-compose.yml` (limits are already an open item).
- [ ] O10. `deploy-prod` uses repository-level secrets without an
      `environment:` and allows `workflow_dispatch` (`ci.yml:185-246`).
      Anyone with write access can run a modified workflow from a branch and
      read `COOLIFY_API_TOKEN`. Fix: a `production` environment restricted to
      `main`.
- [ ] O11. No CodeQL, no dependency review, no `npm audit` in CI; Trivy fails
      only on fixable CRITICAL (`ci.yml:80`). Dependabot exists for npm, the
      Dockerfile and actions but not for `docker-compose.yml`
      (`postgres:18-alpine` is unpinned).
- [x] O12. Mail webhook default URL: same as A10.

Low:

- [x] O13. `MAIL_RETENTION_DAYS`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
      `OTEL_SDK_DISABLED`, `NEXT_OTEL_VERBOSE` and `ALLOW_OWNER_RUNTIME` are
      documented in `ENV_SETUP.md` but not passed to the container in
      `docker-compose.yml:41-99`.
- [x] O14. Docs say the admin password needs 8 characters
      (`.env.example:27`, `ENV_SETUP.md:36`); the code requires 10
      (`lib/password-policy.ts:7`). First start fails with 8 or 9.
- [x] O15. `DEMO_SEED` has no production guard (`scripts/start.sh:40-45`,
      `scripts/seed-demo.ts:359`); demo accounts share one password and
      `reset` rebuilds the workspace on every start.
- [ ] O16. Code defaults and Compose defaults for AI differ (1000 records,
      60 s, 5 h against 100, 5 s, 10 min), and there is no central
      validation of the environment at start. Consider one zod schema run
      from `instrumentation.ts`.
- [x] O17. `.gitignore` and `.dockerignore` cover only `.env` and
      `.env*.local`; `.env.production` could be committed. Fix: `.env*` with
      `!.env.example`.
- [x] O18. Two replicas starting together can collide in the role update and
      the admin check (suspected, harmless but noisy).
- [ ] O19. The schema owner is the PostgreSQL superuser and its URL stays in
      the container environment; the runtime role password is sent as a
      literal in `ALTER ROLE` (`scripts/db-runtime-role.ts:54`);
      `DEFAULT_ADMIN_PASSWORD` stays in the environment after first start.
- [ ] O20. No HSTS from the app (left to the proxy, not mentioned in the
      Coolify guide), `poweredByHeader` not disabled, CSP only on page
      responses, `style-src 'unsafe-inline'` remains.
- [x] O21. The Dockerfile has no `HEALTHCHECK`, and its `CMD node server.js`
      skips migrations, so Dockerfile-only platforms depend on overriding
      the command.
- [x] O22. No `.gitattributes`. An image built from a Windows checkout with
      CRLF in `scripts/start.sh` would not start. Fix: `*.sh text eol=lf`.
- [x] O23. Stale comments: `lib/cross-site.ts:5` ("middleware.ts"),
      `scripts/reset-admin-password.ts:10,38` ("Team page"),
      `scripts/promote-main.mjs:2` (wrong document), `.env.example:39-40`
      (heading with no variable).

Tests:

- [ ] Add focused coverage for AI job history pagination, user lookup,
      rate-limiter edge cases, and concurrent admin bootstrap. Restore,
      import access and deletion, learning, job cancellation, member mail,
      health, and large uploads already have route, smoke, or browser coverage.
- [x] The e2e suite runs as the schema owner (`playwright.config.ts:38`), so
      row security is not exercised in the browser journeys.
- [ ] e2e specs share one database and depend on file order; fixed waits in
      `tests/e2e/journeys.spec.ts:75,85,90` and
      `tests/integration/ai-job-monitor.test.ts:267,399,526` are likely
      flaky on slow runners.

Solid in this area: base image pinned by digest, non-root user, dropped
capabilities, read-only root filesystem; no secrets, `.env`, tests or docs in
the image; `start.sh` fails fast and refuses the owner role in production;
Compose requires the passwords and secrets and publishes no ports; CI has
least-privilege permissions and SHA-pinned actions, and runs migrations on
real PostgreSQL 18; `promote-main.mjs` is fast-forward only; no data dumps or
`.env` tracked in git.

## Documentation

- [x] **D1. `COOLIFY_DEPLOYMENT.md:189-249` ("Method 2") is wrong.** It
      recommends PostgreSQL 16 (only 18 is tested) and its variable list
      omits `APP_DB_USER` / `APP_DB_PASSWORD`, without which
      `scripts/start.sh:9-13` exits. Delete it and link to DEPLOYMENT.md.
- [x] **D2. Missing for an open-source project:** `SECURITY.md` with a
      disclosure contact (the README sends everything to public issues),
      `CONTRIBUTING.md`, a changelog, an upgrade guide.
- [x] D3. Two contradicting backup procedures: `COOLIFY_DEPLOYMENT.md:305-320`
      uses plain SQL and `psql`; `DEPLOYMENT.md:227-236` and
      `scripts/restore-drill.sh` need a custom-format dump. Keep one.
- [x] D4. `DEPLOYMENT.md:207` names `/admin/audit` and `GET /api/audit`; the
      real paths are under `/w/[workspaceId]/` and
      `/api/workspaces/[workspaceId]/`.
- [x] D5. `AGENTS.md:149-150,248` name `app/api/sentences/`,
      `app/api/taxonomies/`, `app/api/imports/`, `app/api/export/`; none
      exists, everything is under `app/api/workspaces/[workspaceId]/`.
- [x] D6. `COOLIFY_DEPLOYMENT.md:268,378` says to run
      `npx prisma migrate deploy`; `scripts/start.sh` avoids `npx` because
      the filesystem is read-only.
- [x] D7. `DEPLOYMENT.md:238-240` says one table is exempt from row
      security; `scripts/restore-check.ts:28` exempts four.
- [x] D8. `ENV_SETUP.md:106-109` has an empty "Progress reports" table and
      line 62 mentions "survey-hub".
- [x] D9. Internal notes in public docs ("backups are handled at company
      level", "our own team runs every workspace").
- [x] D10. `docs/archive/**` has 32 broken relative links after the move.

Proposal per file:

| File | Proposal |
| --- | --- |
| `README.md` | Keep; move "Users and workspace access" above Licence; link SECURITY and CONTRIBUTING |
| `ENV_SETUP.md` | Keep; fix D8 and O14 |
| `DEVELOPMENT.md` | Keep; take "Local development and checks" from AGENTS.md |
| `DEPLOYMENT.md` | Keep as the one operations guide; fix D4, D7; add "Upgrading and rolling back" and "Releases" |
| `COOLIFY_DEPLOYMENT.md` | Cut from 520 to about 120 lines: Coolify steps, deploy triggers, secrets. About 60% repeats other docs |
| `AGENTS.md` | Keep, cut from 454 to about 200 lines; fix D5; replace the double-annotation, user-management and AI detail with links |
| `docs/security.md`, `docs/double-annotation.md`, `docs/open-items.md`, test READMEs | Keep |
| `docs/archive/taxomind-isolation.md` | Move the open work into `open-items.md`, then delete |
| `docs/archive/plans-2026-10/progress-dashboard.md` | Move "Performance budget and evidence" into DEVELOPMENT.md, then delete |
| Rest of `docs/archive/**` (about 6,000 lines of plans and reviews, 6,500 lines of mockup HTML) | Delete from the tree; tag the last commit that has them and name the tag in `open-items.md`. First repoint `.github/dependabot.yml:22`, `DEVELOPMENT.md:70-71`, `open-items.md:46,61` |
| New: `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | Add; CONTRIBUTING can be 30 lines |

## Packages

- [x] **Patch updates to take before release:** `better-auth` 1.7.12 ->
      1.7.25 (13 patch releases behind on the authentication library; read
      its changelog for security fixes), `next` and `eslint-config-next`
      16.4.2 -> 16.4.6, `postcss` 8.5.6 -> 8.5.33, `eslint` 10.13.0 ->
      10.15.0, `tailwindcss` and `@tailwindcss/postcss` 4.3.3 -> 4.3.5,
      `@tanstack/react-query` 5.104.5 -> 5.107.1, `nuqs` 2.10.2 -> 2.10.3,
      `pino` 10.3.1 -> 10.4.0, `@opentelemetry/sdk-trace-node` 2.12.0 ->
      2.12.1, `@playwright/test` 1.64.1 -> 1.65.1 (the browsers in CI must
      match), `vitest` 5.0.5 -> 5.1.0, `prettier` 3.9.9 -> 3.10.1,
      `lucide-react` 1.61.0 -> 1.73.0.
- [ ] **Do not take now:** `prisma` 8 (npm's `latest` tag points at
      `8.0.0-rc.33`, a release candidate, while `@prisma/client` latest is
      7.10.1; keep all three Prisma packages on 7.10.1), `@types/node` 26,
      `typescript` 7 for the build, `@opentelemetry/resources` 3 and
      `exporter-trace-otlp-http` 0.301 (upgrade the four OpenTelemetry
      packages together, after release), `pg` 9 (already an open item).
- [x] Pin `react-markdown` (`^10.1.0` is the only range in the manifest).
- [x] Set the package name, licence and `private` flag. Set the version and
      tag when preparing a release.
- [x] `vitest` warns that the config files use ESM syntax in a file loaded as
      CommonJS; rename the three configs to `.mts`.

## Features to consider before production

- A "session ended, sign in again" message that keeps the open record (F1).
- A warning before leaving a record with unsaved selections (F2).
- A conflict message when someone else changed the record since it was
  opened (L3).
- Record and taxonomy import that accepts Excel's CSV: semicolons, and a
  clear refusal of non-UTF-8 files (L1, L2).
- A preview with the number of labelled records before an import is deleted
  (B3).
- A sign-in limit per account (S2).
- Retry with backoff for AI job start, and a pause per endpoint after
  repeated failures (A1).
- A hard maximum job age with a remote cancel (A6).
- A "test connection" action when saving an AI credential (A25).
- A platform audit view, and sign-in events in the audit log (A18).
- Alerts: jobs pending too long, job failure rate, unsent mail (already in
  open items under "Alerts").
- One start-up check of the environment (O5, O16, A21).
- A written statement on whether more than one app instance is supported
  (A5, O18).
- `SECURITY.md` with a contact address (D2).
