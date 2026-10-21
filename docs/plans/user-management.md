# User management: implementation plan

**Status:** proposed 21 October 2026. Not started; nothing here is implemented.
**Scope:** the admin **Team** page (`/admin/team`) and the user APIs behind it.
**Reference:** [`rowsquared/survey-hub`](https://github.com/rowsquared/survey-hub/tree/dev)
(`dev` branch) already ships most of what is wanted here: its Users page
(`frontend/pages/users.vue`), the last-seen rule (`backend/core/last_seen.py`),
CSV user import (`backend/apps/users/import_*.py`, archived plan
`docs/legacy/USER_IMPORT_PLAN_2026-09-18.md`), deactivation and the last-admin
lock (`backend/apps/users/views.py`), identity rules
(`backend/apps/users/account_validation.py`) and session ending
(`backend/apps/users/sessions.py`). Its contract is written up in
`docs/architecture/TABLES_AUTH.md` § "The Users page". Borrow the rules and the
reasoning, not the code: survey-hub is Django/Nuxt, classiflow is Next.js/Prisma.

Read [AGENTS.md](../../AGENTS.md) and the
[hardening handoff](hardening-handoff.md) first. This plan builds on what the
hardening round finished (W02 sessions, audit log, login throttle) and must not
undo any of its decisions.

## Where classiflow is today

| Area | Today | Gap |
| --- | --- | --- |
| Team table | `app/admin/team/TeamPageClient.tsx`: one unsorted table, no search or filters, `lastLogin` as a UTC date | No way to find a user, sort, or tell who is active |
| Activity | `User.lastLogin`, written in `lib/auth.config.ts` `authorize()` | JWT sessions last 30 days, so `lastLogin` means "last typed a password", not "last used the app". Its `prisma.user.update` also bumps `updatedAt` |
| Creating users | One at a time; admin types a temporary password; `mustResetPassword` forced | No bulk path, no generated password, no "show once / copy" |
| Leaving users | Delete only; 409 if the user wrote comments or started AI jobs | No reversible revocation. [ideas.md](../ideas.md) already asks for deactivation |
| Identity | `username` and `email` unique, case-sensitive; login matches either exactly | `Jane@x.org` and `jane@x.org` can both exist; login is case-sensitive on email |
| Passwords | `min(8).max(256)` in three zod schemas | No shared policy; bcrypt silently ignores bytes past 72; nothing stops `password = username` |
| Last admin | `isLastAdmin()` check, then a separate write | Two admins demoting each other at once can both pass (survey-hub H03) |
| Sessions | `sessionVersion` bumped on any password change | No "sign out everywhere" without changing the password |
| Audit | `lib/audit.ts`, `/admin/audit` with `entityType`/`entityId`/`actorId` filters | No per-user history from the Team page; lockouts not recorded |

## Work packages

Six packages, each one reviewable commit series with its own tests. U1 and U2
deliver what was asked first (last seen, a better page); U4 is the CSV import.
U3 should land before U4 so the importer and the single form share one set of
rules. U5 and U6 are smaller security items that can go in any order after U1.

### U1. "Last seen" column

**Rule (borrowed from survey-hub `core/last_seen.py`):** `lastSeenAt` means "the
app was open in a visible tab and loading data". It is not proof somebody was
typing.

- **Schema:** `User.lastSeenAt DateTime?`, unindexed: the Team list is
  unpaginated and sorted in the browser, and the column is rewritten often.
  Migration with `npx prisma migrate dev --name user_last_seen`.
- **Where it is written:** `checkSession()` in `lib/api-auth.ts`. It already
  reads the user row on every API call, so add `lastSeenAt` to its `select` and
  write only when the stored value is older than **5 minutes** (or null, or in
  the future after a clock fix). Cost: at most one UPDATE per user per five
  minutes, and no extra read. Put the rule in a small `lib/last-seen.ts` with
  unit tests for the staleness check.
- **Use raw SQL for the write**, not `prisma.user.update`/`updateMany`. Prisma
  fills `@updatedAt` on both, so a heartbeat would make every active user look
  "edited by an admin" every five minutes. A conditional statement also
  collapses a burst of parallel requests into one write:

  ```sql
  UPDATE "User" SET "lastSeenAt" = now()
  WHERE id = $1 AND ("lastSeenAt" IS NULL OR "lastSeenAt" < now() - interval '5 minutes' OR "lastSeenAt" > now())
  ```

  Wrap it in try/catch and log on failure: a monitoring stamp must never fail
  a working request. Do the same raw-SQL change for the `lastLogin` write in
  `authorize()`, which bumps `updatedAt` today.
- **Exclude background polls.** These requests prove nothing about a person
  being there:
  - `/api/ai-jobs/active`, polled every 3 s from `AIJobStatusBadge` in **every**
    page header (the same problem as survey-hub's unread-count poll; counting
    it would make any forgotten tab permanently "active");
  - the 5 s polls in `AIJobsClient.tsx` and `TaxonomyAdminClient.tsx`, which
    also keep running while the tab is hidden. Gate them on
    `document.visibilityState` like the queue and badge already do.

  `requireSession()` does not know the request path. Add an option instead,
  for example `requireSession({ roles: [...], passive: true })` or a
  `requirePassiveSession()` sibling, and use it only in those poll handlers.
  Keep the existing call signature working. The 30 s queue refresh only runs
  while the tab is visible and the user opened that page, so it counts.
- **API:** add `lastSeenAt` to the `select` in `GET /api/users` and
  `GET /api/users/[userId]`. It is never writable.
- **UI:** "Last seen" shows relative time (`formatRelativeTime` from
  `lib/utils.ts`) with the exact UTC time as a `title`, and "Never" when null.
  Keep "Last login" next to it with the same treatment; explain the
  difference in a header tooltip ("Last login: last time they typed a
  password. Sessions last 30 days, so this can be old for active users.").
- **Supervisors:** `/api/progress/team` could show the same field for the
  supervisor's subtree. Optional; decide in review.
- **Tests:** integration tests for: written on first call; not rewritten
  within 5 minutes; rewritten after; `updatedAt` unchanged; passive handler
  does not write; failure in the write does not fail the request.

### U2. Team page overhaul

Rewrite `TeamPageClient.tsx` into a list plus a detail drawer; split the
modals into `components/team/` so the file stops growing. Keep the server
component + client component pattern and `serverFetchJSON`.

- **Toolbar:** search (username, name, email), filters for role, supervisor,
  status (active / deactivated / must reset password) and activity
  ("not seen for 7 / 30 days", "never signed in"); a **Clear** button and a
  "12 of 40 users" count. Filtering is client-side: the list is unpaginated
  and small.
- **Columns:** Username (badges: *must reset*, *deactivated*), Name, Email,
  Role, Supervisor, Team size, Open assignments (assigned records not yet
  submitted, instead of the total), Last seen, Last login, Actions.
  Every column except Actions sorts. Follow survey-hub's sort rules: cycle
  asc → desc → default, **nulls last in both directions** (a "Never" must not
  bury the active users), username as tiebreaker, Role by privilege
  (admin > supervisor > labeller) rather than alphabetically.
- **Detail drawer** (click a row): profile and edit form, supervisor chain and
  direct reports, counts (assignments, submitted labels, comments), the
  account's audit history (U6), and the account actions (reset password,
  sign out everywhere, deactivate/reactivate, delete).
- **Create user:** a **Generate** button (18 characters from an unambiguous
  alphabet, `crypto.getRandomValues`), show/hide toggle, and a result dialog
  that shows the credentials once with **Copy** (as in survey-hub). There is no
  mail in classiflow, so this dialog is how the admin hands them over.
- **Replace `confirm()`/`alert()`** with the shared modal and toast patterns
  that W09 introduced. Delete gets a typed confirmation and explains when
  deactivation is the better choice.
- **Accessibility:** `aria-sort` on sortable headers, buttons inside headers,
  focus handling via the existing `Modal`. Wrap the table in
  `overflow-x-auto` (survey-hub lost its Actions column to `overflow-hidden`
  on laptop widths).
- **Tests:** unit tests for sort and filter helpers (put them in a
  `lib/team-table.ts` so they are testable in the Node Vitest setup); one e2e
  journey: create a user, find them by search, sort by last seen, edit,
  deactivate. W10 lists "team" as a missing journey, so this closes that too.

### U3. Account lifecycle and shared rules

Everything the single form and the CSV import must agree on, in one place:
a new `lib/account-rules.ts` (extend `lib/user-rules.ts` if it stays small).

- **Deactivation** (moves the [ideas.md](../ideas.md) item into this plan):
  - `User.deactivatedAt DateTime?` (+ `deactivatedById String?` optional).
  - `authorize()` refuses a deactivated user with the same generic failure as
    a wrong password; `checkSession()` returns 401 for them. Deactivating bumps
    `sessionVersion`, so open sessions end at once.
  - Deactivated users disappear from assignment pickers
    (`components/queue/AssignmentModal.tsx`, which uses `GET /api/users`) and
    supervisor pickers; add `?includeInactive=1` for the Team page only.
    Their labels, comments, AI jobs and imports keep their author.
  - Deactivation dialog offers, unchecked by default, "Also remove their
    assignments on records that are not submitted" so work can be reassigned.
  - Reactivation clears the flag; the admin may set a new temporary password
    in the same step.
  - Delete stays for accounts with no history (today's 409 rule); the 409
    message points to deactivation.
  - Audit: `user.deactivated`, `user.reactivated`.
  - Check every query that lists users for people to act on: queue user
    filter, assignment endpoints (`app/api/sentences/assign`), progress team
    metrics (show deactivated users greyed, do not drop their past work).
- **Last-admin guard under a lock.** Demote, deactivate and delete all count
  *active* admins inside one `prisma.$transaction` that first takes
  `SELECT pg_advisory_xact_lock(<constant>)`, then counts, then writes.
  Today `isLastAdmin()` runs before a separate write. Add a concurrency test
  with two parallel requests (survey-hub `tests_admin_race.py` is the model).
- **Identity rules:**
  - Store emails lowercased-domain at least (or fully lowercased; decide in
    review) on every create path.
  - Refuse a new username or email that equals an existing one **after
    case-folding**, active or deactivated. Apply in `POST /api/users`, the
    importer and `scripts/init-admin.js`.
  - Login: match email case-insensitively; if two accounts match, refuse like
    a wrong password (survey-hub `backends.py`). Usernames stay exact.
  - Before adding a unique index on `lower(email)`, ship a read-only check
    script that lists case-only pairs in each environment. The index is a
    later step, after the data is clean.
- **Password policy** in `lib/password-policy.ts`, used by user create,
  admin reset, self-service reset (`app/api/auth/reset-password/route.ts`) and
  the importer:
  - length 10 to 256 characters **and at most 72 bytes in UTF-8** (bcrypt
    ignores the rest, so two different long passwords would match);
  - not equal to or contained in username, email local part or name;
  - not in a short bundled list of common passwords;
  - self-service reset: the new password must differ from the current one
    (otherwise the forced reset can be satisfied with the handed-out password).
  - Server returns field-level messages; the forms show them.
  - Generated passwords use `crypto.randomInt` on the server and the same
    alphabet as the client generator.
- **Tests:** integration tests for each rule above and for every listing
  that must hide deactivated users. Update [security.md](../security.md) (the
  access matrix and "Sessions" section) in the same commit.

### U4. Bulk user import (CSV)

Adapted from survey-hub's importer, made smaller where classiflow allows it.
Survey-hub needs durable `UserImport`/`UserImportRow` tables because it mails
credentials one row at a time and must survive a crash between "account
created" and "mail sent". Classiflow has no mail, so the import can be
**stateless and all-or-nothing**, following the record importer's dry-run
pattern in `app/api/sentences/import/route.ts`.

**Flow** (an **Import users** button next to **Add user**):

1. The modal explains the columns and offers **Download template** (and, from
   the toolbar, **Export users** in the same format without passwords, so an
   admin can edit an export and re-import new rows).
2. Upload. `POST /api/users/import?dryRun=true` parses and validates the
   whole file and returns every row with its errors and warnings. Nothing is
   written.
3. Preview: counts, errors by row and field, new admins called out, and
   labellers with no supervisor flagged. **Create N users** is enabled only
   when there are no errors. An explicit **Create valid rows only (skips M)**
   option may be added; never choose it silently.
4. Commit: the browser uploads the **same file** again with `dryRun=false`.
   The server re-validates everything (data may have changed since the
   preview) and creates all accounts in **one transaction**, or none.
   Re-submitting after success fails on duplicates instead of creating twice.
5. Result: one row per account. Generated temporary passwords appear **only
   in this response** (`Cache-Control: no-store`), are shown once with copy,
   and can be downloaded once as a credentials CSV built in the browser. The
   modal warns that closing it loses them; the fix afterwards is an admin
   password reset. Nothing with a password is stored or logged.

**File format:** UTF-8 (BOM allowed), comma-delimited, quoted fields allowed,
parsed with the existing `csv-parse` dependency. Limits: **500 rows** and
**1 MB**, as named constants in `lib/constants.ts`, on top of
`lib/upload.ts`. Every header is required; unknown and duplicate headers are
errors (a misspelled column must not vanish silently).

| Column | Rule |
| --- | --- |
| `username` | Required; 3 to 100 characters; unique in file and database after case-folding |
| `email` | Required; valid; same uniqueness rule |
| `name` | Required (matches the current form) |
| `role` | `labeller`, `supervisor` or `admin`, case-insensitive |
| `supervisor` | Optional. Username of an existing admin/supervisor **or of a supervisor row in the same file**. No cycles |
| `password` | Required when `generate_password` is `false`, else empty. Checked against U3's policy; never trimmed |
| `generate_password` | Required `true`/`false`; no default |

```csv
username,email,name,role,supervisor,password,generate_password
maria,maria@example.org,Maria Rossi,supervisor,,,true
ahmed,ahmed@example.org,Ahmed Ali,labeller,maria,,true
```

**Rules worth keeping from survey-hub:**

- Report **all** row errors with their source line number (count lines
  correctly for quoted multi-line cells), not just the first.
- A partly filled row with an empty username is an error; only fully blank
  rows are skipped.
- An in-file collision rejects **every** row involved, not the first one wins.
- The import **never updates** existing accounts. It only creates.
- Every created account has `mustResetPassword = true`.
- Supervisors in the same file: create in dependency order inside the
  transaction (supervisors first), and run `validateSupervisor` logic against
  the planned set so cycles in the file are caught at preview time.
- Lock identities for the commit (`pg_advisory_xact_lock` on a hash of each
  folded username/email, taken in sorted order) so a concurrent single create
  cannot slip a case-variant in between the check and the insert.

**Performance:** bcrypt at cost 10 runs in JavaScript (`bcryptjs`) and takes
tens of milliseconds per password. Hash **before** opening the transaction,
then `createMany` inside it, so the transaction stays short. Measure 500 rows
in CI; if the request is too slow, lower the row cap rather than adding a job
queue.

**Audit:** one `users.imported` entry (count, roles, file name, no
identities beyond IDs), plus the usual `user.created` per account if cheap.
Add the action to `AuditAction` and the `/admin/audit` filter list.

**Code layout:** `lib/user-import.ts` (parse, plan, validate; pure and
unit-tested), `app/api/users/import/route.ts` (admin only via
`requireSession('admin')`), `app/api/users/import/template/route.ts`,
`components/team/UserImportModal.tsx`. All CSV output goes through
`lib/csv.ts` (formula neutralising for free text).

**Tests:** unit tests for the parser (BOM, CRLF, quoted commas and newlines,
missing/unknown/duplicate headers, row limit, bad booleans, password rules,
supervisor-in-file, cycles, in-file collisions, case-only collisions).
Integration tests: non-admins get 403; dry run writes nothing; commit is
all-or-nothing when one row became invalid after the preview; passwords never
appear in the database outside the hash, in audit payloads or in logs; a
second commit of the same file creates nothing.

### U5. Sessions and sign-in security

Small items, each borrowed from survey-hub or left open by W02:

- **Sign out everywhere** (admin action on a user, and for the user on their
  own account page): bump `sessionVersion` without touching the password.
  Audit `user.sessions_revoked`.
- **Record lockouts:** when `lib/login-throttle.ts` locks an identifier, write
  `auth.lockout` to the audit log with the matched user ID if any (never the
  typed identifier for unknown users, never the password). Low volume, useful
  to admins. Do **not** log every login; `lastLogin`/`lastSeenAt` cover that.
- **Show locked-out users** on the Team page (badge from the throttle state)
  with an **Unlock** action. The throttle is in-process; say so in the UI
  tooltip and keep the limit documented in [security.md](../security.md).
- **Forgotten-password and invite links** need outgoing mail, which classiflow
  does not have. Survey-hub's one-time link design (token in the URL
  fragment, identical answer for unknown addresses, per-account cooldown,
  ends all sessions) is the model if mail is added. Out of scope here;
  listed under decisions.
- Admin MFA/SSO stays the open W02 product decision.

### U6. Audit and accountability on the Team page

- **Per-user history** in the U2 drawer: two short lists from the existing
  `/api/audit` filters: changes *to* the account (`entityType=user`,
  `entityId=<id>`) and actions *by* the account (`actorId=<id>`), each with a
  link to `/admin/audit` pre-filtered. Make `/admin/audit` read its filters
  from the URL so the link works.
- **Richer `user.updated` payloads:** keep "fields changed" and the role and
  supervisor `from`/`to` that exist today; add name changes as a flag only (no
  values), and deactivation/reactivation as their own actions (U3).
- **"Created by" / "Created at"** in the drawer, from the `user.created` audit
  entry or a new nullable `createdById` column. Prefer the audit entry; add
  the column only if the drawer query gets awkward.
- **Retention:** survey-hub purges expired records daily. The audit-log
  retention period is already a maintainer decision in the hardening handoff;
  do not invent one here. When it is decided, the purge should not delete
  `user.*` entries sooner than the rest.

## Order and size

| Step | Package | Size | Depends on |
| --- | --- | --- | --- |
| 1 | U1 last seen (schema, write, poll exclusions, column) | S | — |
| 2 | U2 Team page overhaul (table, filters, sort, drawer, generated password) | M | U1 |
| 3 | U3 deactivation + last-admin lock | M | — |
| 4 | U3 identity and password rules (+ case-pair check script) | S–M | — |
| 5 | U4 CSV import | M–L | U3 rules |
| 6 | U5 sign out everywhere, lockout audit/unlock | S | U2 drawer |
| 7 | U6 per-user history, audit filters from URL | S | U2 drawer |

Steps 1 and 3/4 can run in parallel. Each step: typecheck, lint, unit tests,
the integration suite, and for UI steps `npm run build` + `npm run test:e2e`
(see the handoff for commands). For every behaviour change, show that the new
integration test fails on the old code. Update [security.md](../security.md)
and the "Authentication and authorization" section of
[AGENTS.md](../../AGENTS.md) when the rules change.

## Decisions for the maintainer

1. **Deactivate and unassign:** should deactivating a user also remove their
   open (not submitted) assignments by default, or only when ticked?
2. **Email case:** lowercase the whole address on save, or only the domain
   (RFC-correct, what survey-hub does)? Either way comparisons are
   case-insensitive.
3. **Password minimum:** 10 characters proposed (today 8). Existing passwords
   are not affected until they are next changed.
4. **Import scope:** create-only (proposed), or also "update existing users"
   (role/supervisor) from the same file? Survey-hub deliberately never updates.
5. **Credentials CSV download:** acceptable to offer generated passwords as a
   one-time browser download, or copy-only?
6. **Supervisors:** should supervisors see last-seen for their subtree (on
   the progress team view), or is it admin-only?
7. **Outgoing mail:** is SMTP/webhook mail on the roadmap? It unlocks
   credential mails, invite links and forgotten-password links, and would
   change U4 to survey-hub's durable per-row design.

## Out of scope

- Independent double annotation and anything that changes labelling.
- SSO/MFA (open W02 decision).
- Organisation/project multi-tenancy or per-taxonomy permissions.
- Survey-hub's per-survey page permissions: classiflow's roles plus the
  supervisor tree are the access model ([security.md](../security.md)).
