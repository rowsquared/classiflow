# User management: implementation plan

**Archived 22 October 2026:** implemented. What is still open (environment,
maintainer decisions, Taxomind) is in [open items](../../plans/open-items.md).

**Status:** proposed 21 October 2026; revised the same day for workspaces and
Better Auth (next section, which takes precedence over the original text below).

## Revision for workspaces and Better Auth (21 October 2026)

Since this plan was written, Better Auth replaced next-auth (database
sessions, scrypt hashing, `Verification` tokens, admin plugin) and accounts
were split from workspace membership
([workspace isolation](workspace-isolation.md)). Read every package below
through this mapping:

| Package | Now |
| --- | --- |
| U1 last seen | `WorkspaceMembership.lastSeenAt` (exists in the schema) is "last active **in this workspace**", written by workspace requests at most every 5 minutes with a conditional raw `UPDATE`; background polls pass `passive`. Global activity is the latest `Session.updatedAt`, shown on `/accounts` only. |
| U2 Team page | The Team page manages **members of one workspace**; account actions (temporary password, name) follow the "local account" rule (only accounts that belong to this workspace alone and never signed in; platform admins always). The platform `/accounts` page covers global accounts. |
| U3 lifecycle | "Deactivate" in this workspace = **suspend the membership** (done: `DELETE`/`PUT status`); deactivate everywhere = **ban** (platform admin, done). Last-admin checks are serialised (done). Emails and usernames are stored lower case (done). bcrypt's 72-byte limit is moot (scrypt). Remaining: password policy, "unassign open records" on removal. |
| U4 CSV import | Imports **members** into the current workspace: new accounts are created; existing accounts may only be added by platform admins (no account-existence probing). Create-only. |
| U5 sessions | "Sign out everywhere" = delete the user's `Session` rows (platform admins; a person for themselves). Lockout records and "Unlock" no longer apply: the limit is per IP in the database (`RateLimit`), not per account. |
| U6 audit | Workspace audit only shows the workspace's events; per-member history in the drawer reads it; account events (platform) show on `/accounts`. `/w/[id]/admin/audit` reads its filters from the URL. |
| U7 mail | Transport and outbox as written. Password links use **Better Auth's reset-password flow** (`requestPasswordReset` / `resetPassword`, token in `Verification`, `sendResetPassword` hook) instead of hand-rolled HMAC tokens; invitations are the same flow with a longer expiry and an "invitation" template. Links are built from `BETTER_AUTH_URL`. Invitations name the workspace and role; accepting never reveals other memberships. |

**Decisions taken (defaults proposed in "Decisions for the maintainer"; change
them here if needed):** 1. removal does not unassign by default (checkbox);
2. whole email lower-cased (done); 3. minimum 10 characters for new
passwords; 4. import is create-only; 5. invitation links and emailed generated
temporary passwords are supported (see maintainer revision below);
6. generated passwords: one-time copy and a browser-built CSV
download; 7. last seen and invitation resending are workspace-admin-only
(platform admins retain administrative access); 8. n8n transport only
(no SMTP dependency); 9. invitations 72 h, password links 60 min;
10. classiflow gets its own `N8N_EMAIL_WEBHOOK_SECRET` value.

**Order now:** U1 → U5 → U3 password policy → U6 → U2 → U7 (a, c, b) → U4.

### Maintainer revision: temporary-password email (21 October 2026)

The maintainer explicitly approved generated temporary passwords by email,
as in survey-hub, alongside invitation links. This revision takes precedence
over the older links-only text and outbox assumptions below. This is planned
U7/U4 behavior, not a statement that email is implemented.

- **Permissions:** only workspace admins may resend invitations within their
  workspace; supervisors may not. Platform admins retain administrative access.
  Credential actions still obey the local-account rule above. Adding an
  existing shared identity to a workspace must never generate, replace or
  email a password for that identity.
- **Create form:** when mail is configured, offer "Send invitation link" or
  "Generate and email temporary password"; retain the no-mail handover option.
  Generate the temporary password on the server using the shared policy and
  cryptographic randomness. Mail the username, temporary password, trusted
  sign-in URL, workspace and intended role to the stored email address.
- **Forced change:** set `mustResetPassword = true`; the person must choose a
  different password before accessing application data. The temporary password
  stops working after that change. It is not a single-use token and can still
  authenticate until the password is changed; do not describe it as one-use.
- **Survey-hub reference checked:** `backend/apps/users/emails.py` composes
  escaped HTML and plain text, excludes credentials from the preheader,
  sends only after account commit, and reports delivery separately from
  account creation. Its import design in
  `docs/legacy/USER_IMPORT_PLAN_2026-09-18.md` persists a mail-attempt claim
  before sending and never recovers a lost password by regenerating it.
- **Credential delivery:** persist a metadata-only attempt claim before
  calling the transport, and send the in-memory password after account commit.
  Never persist plaintext or encrypted passwords, message bodies or passwords
  in job arguments, logs, transport error details, audit payloads or status
  responses. Only the account's password hash is stored. Credential mail cannot
  use the generic recoverable outbox worker: it cannot rebuild the original
  password at send time. Delivery failure must not undo account creation.
- **Outcomes and recovery:** distinguish `sent`, definite `failed`, and
  `unknown` (timeout/network/server error or an abandoned sending claim).
  Never automatically retry credential mail, regenerate a password, or change
  an account password on request replay. A crash before sending may leave
  "created; email not attempted". Offer a password link or an explicit,
  authorized temporary-password reset; warn about possible prior delivery
  when the outcome is unknown. Invitation-link resending remains separate.
- **CSV:** add `access = email_password` for a newly created account (mail
  required); retain `invite`, `generate` and `password`. Generate only at
  commit, hash before the account transaction, and deliver after commit with
  a durable claim per created account. All-or-nothing account creation may
  remain, but mail outcomes are per row. Persist an import execution identity
  and row outcomes without secrets so duplicate/concurrent/replayed commits
  cannot create accounts or send credentials twice. Dry runs never generate
  passwords or send mail. Invitation mail may use the recoverable link outbox;
  credential mail must use the in-memory, non-retrying delivery path above.
- **Verification for U7/U4:** cover both create and CSV flows, forced change,
  supervisor denial, shared-account protection, duplicate/concurrent requests,
  crash before/after the send claim, lost responses, uncertain delivery, and
  absence of passwords in persisted metadata, logs and status/replay responses.

### Implementation status

- **U1 done:** `lib/last-seen.ts` (5-minute conditional raw UPDATE in UTC),
  written by workspace requests and the workspace layout, passive for the AI
  job badge poll; "Last seen" and "Last login" on the Team page;
  `tests/integration/last-seen.test.ts`.
- **U2 done** (`5da2db7`): search, filters, sorting (`lib/team-table.ts`,
  unit tested), member drawer with role/supervisor/temporary password and
  audit links, show-once password dialog, toasts; e2e journeys for Team and
  Accounts. Mail-dependent parts (email indicator, invitation mode, resend)
  wait for U7.
- **U3 done**, including changing a member's email (22 October 2026):
  `lib/password-policy.ts` (10–256 characters, not common, not built from
  username/email/name; the forced change must differ) applied to every
  password-setting path including scripts and Better Auth's own minimum;
  suspension = removal from a workspace; ban = everywhere; removal can unassign
  open records (U2). Email changes: platform admins on `/api/users/[id]`,
  workspace admins under the local-account rule on the member API; unique after
  lower-casing, open links end, a notice goes to the old address,
  `user.email_changed` without addresses.
- **U5 done:** "Sign out other devices" (user menu, Better Auth
  `revokeOtherSessions`), "Sign out everywhere" for platform admins on
  `/accounts` (`user.sessions_revoked`).
- **U6 done:** `/w/[id]/admin/audit` reads `action`, `entityType`,
  `entityId`, `actorId` from the URL; the drawer links to it. Mail events
  (`mail.password_link_requested`, `mail.invitation_requested`, and the outcome
  `mail.sent` / `mail.failed` / `mail.unknown` of every admin-requested mail;
  ids and purpose only) and invitation events (`member.invited`,
  `member.invitation_revoked`, `members.imported`). The drawer shows "Added here
  … by …" (`WorkspaceMembership.addedById`, local information only) and the
  account's creation date (`User.createdById` is stored but not shown across
  workspaces).
- **U7a done:** `lib/mail/` (config read once, `mailEnabled()`, n8n webhook with
  sent/failed/unknown, folded subjects, escaped email-safe layout without
  secrets in the preheader, templates), the `OutgoingMail` outbox (claim with
  one conditional update, links minted at send time, `sending` past the timeout
  becomes `unknown`, a timer per instance sends rows a restart left behind),
  `GET /api/system/mail`, `scripts/mock-mail-webhook.mjs`. n8n only, no SMTP
  (decision 8). Retention of `OutgoingMail`: documented as a prune in
  DEPLOYMENT.md "Mail", not automated (audit retention is still open).
- **U7c done:** `/forgot-password` and `/set-password`, password links in Better
  Auth's `Verification` table (SHA-256 of a random secret, purpose and the
  email it was sent to; `lib/account-links.ts`) instead of the HMAC tokens
  above. Better Auth's own reset endpoints stay disabled: confirming needs our
  policy, a row lock, the audit entry and the notice. Identical answers with
  the lookup after the response, a 15-minute cooldown per account across
  instances (a definite failure frees it), per-IP limits in the database
  (`lib/rate-limit.ts`), check vs. confirm, "password changed" notice. The
  endpoints answer 404 without mail; the set-password endpoints stay available
  for links issued earlier. Admin "Send password link" in the drawer.
- **U7b / P4 done:** create modes "Email a link to choose a password" (account
  without a password, `invitedAt`/`invitationAcceptedAt`, badge "invited",
  resend from the drawer), "Generate and email a temporary password" (claim row
  before sending, password in memory only, sent after the commit, never
  retried; a row that never reached `sending` is marked "not sent" by the
  recovery) and the existing handover. **Workspace invitations**
  (`WorkspaceInvitation`, `/w/[id]/admin/team` "Invite by email", `/invitation`)
  for people who have or will have an account: same answer whatever accounts
  exist, accepted only by the signed-in account with that address, inviter,
  workspace and role re-checked at acceptance, resend replaces the link,
  withdraw. Workspace admins only; supervisors get 403.
- **U4 done:** CSV member import (`lib/member-import.ts`, unit tested;
  `/users/import` with dry run, commit, `importKey` replay protection persisted
  in `MemberImport`/`MemberImportRow` without secrets; template; access
  `invite`, `email_password`, `generate`, `password`; all-or-nothing accounts,
  per-row mail outcomes polled by the result dialog; generated passwords shown
  once with copy and a browser-built CSV download). Rows are created with
  per-row inserts in one transaction after hashing outside it; 500 rows is the
  cap.
- **Done 22 October 2026:** automatic retention of `OutgoingMail` (finished
  rows older than `MAIL_RETENTION_DAYS`, default 90, are deleted hourly) and
  "Export CSV" on the Team page (`/users/export`: the import's columns first,
  then status, invitation, last seen/login and open assignments; no secrets).
- **Not done:** an SMTP fallback (decision 8: n8n only), locked-out badges
  (moot, see U5). Verify against the live n8n workflow when staging exists
  (only the mock and the test stand-in have been used).

**Scope:** the admin **Team** page (`/admin/team`), the user APIs behind it,
and outgoing email for accounts (invitations, forgotten passwords, notices).
**Reference:** [`rowsquared/survey-hub`](https://github.com/rowsquared/survey-hub/tree/dev)
(`dev` branch) already ships most of what is wanted here:

| Survey-hub file | What to borrow |
| --- | --- |
| `frontend/pages/users.vue` | Users table: search, filters, sorting, last seen |
| `backend/core/last_seen.py`, `core/middleware.py` | The last-seen rule and where it is written |
| `backend/core/mail.py`, settings "Outgoing email" | Mail transport: n8n webhook, SMTP fallback, the on/off gate, sent/failed/unknown |
| `backend/apps/users/emails.py`, `core/email_layout.py` | Credentials mail and the email-safe HTML layout |
| `backend/apps/users/forgot_password*.py` | One-time password links |
| `backend/apps/users/import_*.py`, `docs/legacy/USER_IMPORT_PLAN_2026-09-18.md` | CSV user import |
| `backend/apps/users/views.py`, `account_validation.py`, `sessions.py` | Deactivation, last-admin lock, identity rules, ending sessions |
| `docs/architecture/TABLES_AUTH.md` § "The Users page", § "Forgotten passwords"; `MAPS_MAIL.md` § "Outgoing email" | The written contracts and their reasoning |

Borrow the rules and the reasoning, not the code: survey-hub is Django/Nuxt
with a Celery worker; classiflow is a single Next.js/Prisma app without one.

Read [AGENTS.md](../../../AGENTS.md) and the
[hardening handoff](../../archive/hardening-2026-10/hardening-handoff.md) (archived) first. This plan builds on what the
hardening round finished (W02 sessions, audit log, login throttle) and must not
undo any of its decisions.

## Where classiflow is today

| Area | Today | Gap |
| --- | --- | --- |
| Team table | `app/admin/team/TeamPageClient.tsx`: one unsorted table, no search or filters, `lastLogin` as a UTC date | No way to find a user, sort, or tell who is active |
| Activity | `User.lastLogin`, written in `lib/auth.config.ts` `authorize()` | JWT sessions last 30 days, so `lastLogin` means "last typed a password", not "last used the app". Its `prisma.user.update` also bumps `updatedAt` |
| Email | None. No transport, no templates, no env vars | Credentials are handed over by hand; no forgotten-password flow; a locked-out user needs an admin |
| Creating users | One at a time; admin types a temporary password; `mustResetPassword` forced | No bulk path, no invitations, no generated password, no "show once / copy" |
| Leaving users | Delete only; 409 if the user wrote comments or started AI jobs | No reversible revocation. [ideas.md](../../ideas.md) already asks for deactivation |
| Identity | `username` and `email` unique, case-sensitive; login matches either exactly | `Jane@x.org` and `jane@x.org` can both exist; login is case-sensitive on email |
| Passwords | `min(8).max(256)` in three zod schemas | No shared policy; bcrypt silently ignores bytes past 72; nothing stops `password = username` |
| Last admin | `isLastAdmin()` check, then a separate write | Two admins demoting each other at once can both pass (survey-hub H03) |
| Sessions | `sessionVersion` bumped on any password change | No "sign out everywhere" without changing the password |
| Audit | `lib/audit.ts`, `/admin/audit` with `entityType`/`entityId`/`actorId` filters | No per-user history from the Team page; lockouts not recorded |

## Work packages

Seven packages, each one reviewable commit series with its own tests.

- U1 and U2 deliver what was asked first: last seen and a better page.
- U3 holds the shared account rules. Land it before U4 so the single form and
  the CSV import agree.
- U7 is email. Its transport (U7a) is small and independent and should land
  early, because invitations change how U2's create form and U4's import hand
  over access. The forgotten-password flow (U7c) can come later.
- U5 and U6 are smaller security and audit items.

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
  status (active / deactivated / must reset password / invitation pending) and
  activity ("not seen for 7 / 30 days", "never signed in"); a **Clear** button
  and a "12 of 40 users" count. Filtering is client-side: the list is
  unpaginated and small. A small **Email: on / off** indicator shows whether
  mail is configured (U7a), so admins know which create flow they will get.
- **Columns:** Username (badges: *must reset*, *invited*, *deactivated*), Name,
  Email, Role, Supervisor, Team size, Open assignments (assigned records not
  yet submitted, instead of the total), Last seen, Last login, Actions.
  Every column except Actions sorts. Follow survey-hub's sort rules: cycle
  asc → desc → default, **nulls last in both directions** (a "Never" must not
  bury the active users), username as tiebreaker, Role by privilege
  (admin > supervisor > labeller) rather than alphabetically.
- **Detail drawer** (click a row): profile and edit form, supervisor chain and
  direct reports, counts (assignments, submitted labels, comments), invitation
  and last mail outcome (U7), the account's audit history (U6), and the
  account actions (send password link / set temporary password, resend
  invitation, sign out everywhere, deactivate/reactivate, delete).
- **Create user**, two modes chosen by whether mail is on (U7b):
  - **Mail on (default): "Send invitation".** No password field. The account
    is created without a usable password and the user gets a link to choose
    one.
  - **Mail off, or the admin unticks "Send invitation": temporary password.**
    A **Generate** button (18 characters from an unambiguous alphabet,
    `crypto.getRandomValues`), show/hide toggle, and a result dialog that shows
    the credentials once with **Copy** (as in survey-hub).
- **Replace `confirm()`/`alert()`** with the shared `Modal` and
  `components/Toast.tsx` that W09 introduced. Delete gets a typed confirmation
  and explains when deactivation is the better choice.
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

- **Deactivation** (moves the [ideas.md](../../ideas.md) item into this plan):
  - `User.deactivatedAt DateTime?` (+ `deactivatedById String?` optional).
  - `authorize()` refuses a deactivated user with the same generic failure as
    a wrong password; `checkSession()` returns 401 for them. Deactivating bumps
    `sessionVersion`, so open sessions end at once. Deactivated accounts get
    no mail of any kind and their open invitation or password links stop
    working (U7).
  - Deactivated users disappear from assignment pickers
    (`components/queue/AssignmentModal.tsx`, which uses `GET /api/users`) and
    supervisor pickers; add `?includeInactive=1` for the Team page only.
    Their labels, comments, AI jobs and imports keep their author.
  - Deactivation dialog offers, unchecked by default, "Also remove their
    assignments on records that are not submitted" so work can be reassigned.
  - Reactivation clears the flag; the admin may send a password link or set a
    temporary password in the same step.
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
  - Store emails with at least the domain lowercased (or fully lowercased;
    decide in review) on every create path.
  - Refuse a new username or email that equals an existing one **after
    case-folding**, active or deactivated. Apply in `POST /api/users`, the
    importer and `scripts/init-admin.js`.
  - Login: match email case-insensitively; if two accounts match, refuse like
    a wrong password (survey-hub `backends.py`). Usernames stay exact.
  - Before adding a unique index on `lower(email)`, ship a read-only check
    script that lists case-only pairs in each environment. The index is a
    later step, after the data is clean. Email now matters more: it is where
    invitations and password links go (U7).
  - **Changing a user's email** (admin, from the drawer): today the edit form
    cannot. Allow it with the same uniqueness rule; it invalidates open links
    (U7c token covers the email) and sends a notice to the **old** address
    when mail is on. Audit `user.email_changed` (no addresses in the payload).
- **Password policy** in `lib/password-policy.ts`, used by user create,
  admin reset, self-service reset (`app/api/auth/reset-password/route.ts`),
  the set-password link (U7c) and the importer:
  - length 10 to 256 characters **and at most 72 bytes in UTF-8** (bcrypt
    ignores the rest, so two different long passwords would match);
  - not equal to or contained in username, email local part or name;
  - not in a short bundled list of common passwords;
  - self-service reset and link reset: the new password must differ from the
    current one (otherwise the forced reset can be satisfied with the
    handed-out password).
  - Server returns field-level messages; the forms show them.
  - Generated passwords use `crypto.randomInt` on the server and the same
    alphabet as the client generator.
- **Tests:** integration tests for each rule above and for every listing
  that must hide deactivated users. Update [security.md](../../security.md) (the
  access matrix and "Sessions" section) in the same commit.

### U4. Bulk user import (CSV)

Adapted from survey-hub's importer. Survey-hub mails each new account its
**password**, so it needs durable `UserImport`/`UserImportRow` tables, a
per-row mail claim and at-most-once sending: a password mail sent twice, or
lost after the response, is a security and support problem. This plan avoids
that by mailing **invitation links** instead (U7b): a link is not a password,
sending a second one is harmless, and an admin can resend from the Team page
at any time. So account creation can stay **stateless and all-or-nothing**,
following the record importer's dry-run pattern in
`app/api/sentences/import/route.ts`, and mail goes out after the commit.

**Flow** (an **Import users** button next to **Add user**):

1. The modal explains the columns and offers **Download template** (and, from
   the toolbar, **Export users** in the same format without passwords, so an
   admin can edit an export and re-import new rows).
2. Upload. `POST /api/users/import?dryRun=true` parses and validates the
   whole file and returns every row with its errors and warnings. Nothing is
   written, nothing is mailed.
3. Preview: counts, errors by row and field, new admins called out, labellers
   with no supervisor flagged, and how each account gets access (invitation
   mail / supplied password / generated password). If mail is off, the
   `access` column may not be `invite` and the preview says so. **Create N
   users** is enabled only when there are no errors. An explicit **Create
   valid rows only (skips M)** option may be added; never choose it silently.
4. Commit: the browser uploads the **same file** again with `dryRun=false`.
   The server re-validates everything (data may have changed since the
   preview) and creates all accounts in **one transaction**, or none.
   Re-submitting after success fails on duplicates instead of creating twice.
5. Mail: after the commit, invitations are queued in the `OutgoingMail`
   table (U7a) and sent in the background with low concurrency. The result
   dialog shows each account's mail status and keeps updating it (poll
   `GET /api/users/invitations?ids=…` while visible). Failed or unknown ones
   get **Resend**.
6. Passwords: rows with `access = generate` get a temporary password that
   appears **only in the commit response** (`Cache-Control: no-store`), shown
   once with copy and downloadable once as a credentials CSV built in the
   browser. The modal warns that closing it loses them; the fix afterwards is
   a password link or an admin reset. Nothing with a password is stored,
   mailed or logged.

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
| `access` | Required: `invite` (mail a link; needs mail on), `generate` (temporary password shown once to the admin) or `password` (use the `password` column) |
| `password` | Required when `access` is `password`, else empty. Checked against U3's policy; never trimmed |

```csv
username,email,name,role,supervisor,access,password
maria,maria@example.org,Maria Rossi,supervisor,,invite,
ahmed,ahmed@example.org,Ahmed Ali,labeller,maria,invite,
li,li@example.org,Li Wei,labeller,maria,generate,
```

**Rules worth keeping from survey-hub:**

- Report **all** row errors with their source line number (count lines
  correctly for quoted multi-line cells), not just the first.
- A partly filled row with an empty username is an error; only fully blank
  rows are skipped.
- An in-file collision rejects **every** row involved, not the first one wins.
- The import **never updates** existing accounts and never mails them.
- Every created account has `mustResetPassword = true` (password rows) or no
  usable password until the invitation is used (invite rows).
- Supervisors in the same file: create in dependency order inside the
  transaction (supervisors first), and run `validateSupervisor` logic against
  the planned set so cycles in the file are caught at preview time.
- Lock identities for the commit (`pg_advisory_xact_lock` on a hash of each
  folded username/email, taken in sorted order) so a concurrent single create
  cannot slip a case-variant in between the check and the insert.

**Performance:** bcrypt at cost 10 runs in JavaScript (`bcryptjs`) and takes
tens of milliseconds per password. Hash **before** opening the transaction,
then `createMany` inside it, so the transaction stays short. Invite rows need
no hash. Measure 500 rows in CI; if the request is too slow, lower the row cap
rather than adding a job queue.

**Audit:** one `users.imported` entry (count, roles, access modes, file name,
no identities beyond IDs), plus the usual `user.created` per account if cheap.
Add the action to `AuditAction` and the `/admin/audit` filter list.

**Code layout:** `lib/user-import.ts` (parse, plan, validate; pure and
unit-tested), `app/api/users/import/route.ts` (admin only via
`requireSession('admin')`), `app/api/users/import/template/route.ts`,
`components/team/UserImportModal.tsx`. All CSV output goes through
`lib/csv.ts` (formula neutralising for free text).

**Tests:** unit tests for the parser (BOM, CRLF, quoted commas and newlines,
missing/unknown/duplicate headers, row limit, bad `access` values, password
rules, `invite` while mail is off, supervisor-in-file, cycles, in-file
collisions, case-only collisions). Integration tests: non-admins get 403; dry
run writes and mails nothing; commit is all-or-nothing when one row became
invalid after the preview; invitations are queued only after the commit;
passwords never appear in the database outside the hash, in mail, audit
payloads or logs; a second commit of the same file creates and mails nothing.

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
  tooltip and keep the limit documented in [security.md](../../security.md).
- **Login page:** "Forgot password?" appears only when mail is on (U7c).
- Admin MFA/SSO stays the open W02 product decision.

### U6. Audit and accountability on the Team page

- **Per-user history** in the U2 drawer: two short lists from the existing
  `/api/audit` filters: changes *to* the account (`entityType=user`,
  `entityId=<id>`) and actions *by* the account (`actorId=<id>`), each with a
  link to `/admin/audit` pre-filtered. Make `/admin/audit` read its filters
  from the URL so the link works.
- **Richer `user.updated` payloads:** keep "fields changed" and the role and
  supervisor `from`/`to` that exist today; add name changes as a flag only (no
  values), and deactivation, reactivation and email changes as their own
  actions (U3).
- **Mail events** in the audit log: `mail.invitation_sent`,
  `mail.password_link_requested` (by an admin; self-service requests are not
  audited per request, see U7c), `mail.failed`. IDs and outcomes only.
- **"Created by" / "Created at"** in the drawer, from the `user.created` audit
  entry or a new nullable `createdById` column. Prefer the audit entry; add
  the column only if the drawer query gets awkward.
- **Retention:** survey-hub purges expired records daily. The audit-log
  retention period is already a maintainer decision (modernization plan,
  "Carried over from hardening");
  do not invent one here. When it is decided, the purge should not delete
  `user.*` entries sooner than the rest. `OutgoingMail` rows (U7a) get their
  own short retention (proposal: 30 days).

### U7. Outgoing email (n8n webhook)

Classiflow has no mail today. Survey-hub sends through the shared rowsquared
**"E-MAIL API" n8n workflow** (it owns the SMTP credentials), with plain SMTP
as a fallback. Use the same workflow and **the same environment variable
names**, so one Coolify secret setup works for both apps.

#### U7a. Transport, configuration and outbox

**Environment variables** (add to `ENV_SETUP.md` in a new "Email (optional)"
section, `.env.example` commented out, and `docker-compose.yml` passthrough):

| Variable | Default | Secret | Purpose |
| --- | --- | --- | --- |
| `N8N_EMAIL_WEBHOOK_SECRET` | empty | yes | Header value the workflow checks. **Empty means mail is off.** Set means the n8n transport is used |
| `N8N_EMAIL_WEBHOOK_URL` | `https://n8n.rowsquared.com/webhook/send-email` | no | Workflow endpoint (not a secret; same default as survey-hub) |
| `N8N_EMAIL_WEBHOOK_HEADER` | `send-email-api` | no | Name of the header that carries the secret |
| `N8N_EMAIL_WEBHOOK_TIMEOUT` | `15` (seconds) | no | The workflow answers only after its SMTP send finished, so this bounds a real delivery |
| `APP_BASE_URL` | falls back to `AUTH_URL`, then `NEXTAUTH_URL` | no | Public URL used in mail links. **Never** taken from the request: `AUTH_TRUST_HOST=true` means the `Host` header is trusted for auth, and a forged host must not end up in a password link. If empty, mails that need a link are not sent (feature off) |
| `INVITATION_LINK_HOURS` | `72` | no | Lifetime of an invitation link |
| `PASSWORD_RESET_LINK_MINUTES` | `60` | no | Lifetime of a forgotten-password link (same name as survey-hub) |
| `EMAIL_HOST`, `EMAIL_PORT` (`587`), `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` (`true`), `EMAIL_TIMEOUT` (`10`), `DEFAULT_FROM_EMAIL` | empty | password: yes | **Phase 2, optional:** SMTP fallback for self-hosters without the n8n workflow. Needs a new dependency (`nodemailer`), so only add it if someone outside rowsquared needs it |

**Transport choice** (one decision, in `lib/mail/config.ts`, read once):
`N8N_EMAIL_WEBHOOK_SECRET` set → n8n; else `EMAIL_HOST` set → SMTP (phase 2);
else **off**. Unlike survey-hub there is no "console" transport in
development: credential and link mails must never be written to a log. For
local testing add `scripts/mock-mail-webhook.mjs`, a tiny HTTP server that
accepts the webhook and prints only `to` and `subject` (and the link, clearly
marked dev-only), and point `N8N_EMAIL_WEBHOOK_URL` at it. Tests use an
in-memory transport.

**`lib/mail/`** (server only):

- `transport.ts`: `mailEnabled()` (the single gate every caller checks,
  never the env vars directly) and `sendMail({ to, subject, html, text })`.
- `n8n.ts`: one `fetch` POST per message with
  `{ to, subject, body }` JSON (`body` is HTML) and the secret header,
  bounded by `AbortSignal.timeout(N8N_EMAIL_WEBHOOK_TIMEOUT)`. Rules from
  survey-hub `core/mail.py`:
  - The workflow fixes the sender; there is no `from`, `cc`, `bcc` or
    attachment. The API has no such fields, so they cannot be dropped silently.
  - Fold the subject to one line.
  - **Outcomes:** 2xx → `sent`; 4xx → `failed` (definite refusal: wrong secret,
    bad payload; resending is safe); timeout, network error or 5xx →
    `unknown` (the workflow may already have sent it). Never report
    `unknown` as `failed`.
  - Never log the payload or the secret. Error detail may quote a short excerpt
    of the **response** for non-credential mail only.
- `layout.ts`: the email-safe HTML shell (table layout, inline styles on
  every element, no `<style>` block, no images, a hidden preheader). Port the
  structure of survey-hub `core/email_layout.py`. Escape every interpolated
  value. Keep secrets (passwords, links) out of the preheader, which shows on
  lock screens.
- `templates/`: one module per mail, each returning `{ subject, html, text }`:
  invitation, password link, password changed notice, temporary password (only
  if decision 5 says so), email address changed notice.

**Outbox table** `OutgoingMail` (new migration): `id`, `userId` (nullable,
`SetNull`), `purpose` (`invitation` | `password_link` | `password_changed` |
`email_changed` | `credentials`), `status` (`pending` | `sending` | `sent` |
`failed` | `unknown`), `attempts`, `detail` (safe text only), `requestedById`,
`createdAt`, `sentAt`. It never stores the body, the link or a password. It
gives the Team page a mail status per user, makes bulk sending resumable, and
lets an admin see "unknown" instead of guessing.

- **Sending** happens after the response, using Next's `after()` (stable in
  Next 15.1+; classiflow is on 15.5): claim rows (`pending` → `sending` in one
  `UPDATE … RETURNING`), build the mail **at send time** (a link is minted
  then, so nothing secret sits in the table), send with a concurrency of 2–3,
  record the outcome.
- **Restarts:** a row left in `sending` longer than the timeout becomes
  `unknown`, never resent automatically (survey-hub's at-most-once rule). A
  row left in `pending` (process died before claiming) is picked up by the same
  rate-limited recovery hook pattern as `ensureJobsMonitored()` in
  `lib/ai-job-monitor.ts`, or shown as "not sent – resend". Consider multiple
  app instances: the claim `UPDATE` makes double sends impossible.
- **Admin visibility:** `GET /api/system/mail` (admin) returns
  `{ enabled, transport: 'n8n' | 'smtp' | 'off', baseUrl }` with no secrets.
  The Team page shows it (U2), and the drawer shows each user's last mail per
  purpose with **Resend** for links.

**Tests:** unit tests for the outcome mapping (2xx, 401, 422, 500, 502,
timeout, DNS error), subject folding, HTML escaping (a name containing
`<script>` and `&`), no secret in the preheader, and that the payload never
appears in captured `console` output. Integration tests for the outbox claim
under two concurrent senders and the `sending` → `unknown` recovery.

#### U7b. Invitations

The upgrade survey-hub's `emails.py` names but never built: instead of mailing
a password, mail a link where the user sets their own.

- **Creating** with "Send invitation": the account gets an unusable password
  hash (random, never shown) and `mustResetPassword = false` (they will choose
  their own), plus `invitedAt`. Login with any password fails as for a wrong
  password. An `OutgoingMail(purpose=invitation)` row is queued after the
  account commits; the create response returns at once with mail status
  `pending`. A mail problem never undoes or fails the account creation.
- **The link:** `{APP_BASE_URL}/set-password#t=<token>` with the token in the
  **fragment**, so it never reaches a server log, the proxy or a `Referer`.
  The token is the U7c token with `purpose=invitation` and
  `INVITATION_LINK_HOURS`.
- **Using it** is the same set-password page and endpoints as U7c. On success
  `invitedAt` stays, `invitationAcceptedAt` is set, and the Team page badge
  "invited" disappears.
- **Resend invitation** (drawer, bulk result dialog, or a Team-page bulk
  action "Resend to all pending"): queues a new mail. Older links keep working
  until they expire or the user sets a password, because the token covers the
  password hash; that is acceptable for a link, not for a password.
- **Expired invitation:** the page says so and tells the user to ask their
  admin; the Team page shows "invitation expired" with Resend.
- **Mail off:** the option is hidden and creation falls back to a temporary
  password (U2). An admin can still send an invitation later once mail is on.

#### U7c. Forgotten-password links

Port survey-hub's flow (`forgot_password.py`, TABLES_AUTH § "Forgotten
passwords"); classiflow has no Celery, so `after()` plus the outbox take the
worker's role.

- **Pages** `/forgot-password` and `/set-password` work signed out. Add them
  to the public paths in `middleware.ts` (today only `/login` is), and keep
  them reachable for a signed-in user who still has to reset.
- **`POST /api/auth/forgot-password`** takes an email, validates its shape,
  answers **identically** for every address and does **no database lookup in
  the request**: the lookup and send run in `after()`. So neither the answer
  nor its timing reveals whether an account exists. Who gets a mail: active
  (not deactivated) accounts whose stored email matches case-insensitively; the
  mail goes to the **stored** address and names the username.
- **Token:** stateless, no table. HMAC-SHA256 with a key derived from
  `NEXTAUTH_SECRET` via HKDF and a purpose label (`classiflow:password-link:v1`),
  over `userId`, purpose, expiry **and** the current password hash, email,
  `sessionVersion` and `deactivatedAt`. So a link dies when the password
  changes, the email changes, sessions are revoked, the account is
  deactivated, or `NEXTAUTH_SECRET` rotates; otherwise after
  `PASSWORD_RESET_LINK_MINUTES`. Put it in `lib/account-links.ts` with unit
  tests for each invalidation.
- **Opening spends nothing:** `POST /api/auth/set-password/check` only says
  whether the token is good, so a mail scanner that fetches links cannot use
  it up. The page moves the token out of the address bar into
  `sessionStorage` for that tab, so a reload still works.
- **`POST /api/auth/set-password/confirm`:** in one transaction, lock the user
  row (`SELECT … FOR UPDATE`), re-check the token, run the U3 password policy,
  refuse the current password, set the new hash, clear `mustResetPassword`,
  bump `sessionVersion` (ends all sessions), then queue a "your password was
  changed" notice. Returns no session: the user signs in with the new password.
- **Limits:** one link per account per 15 minutes (a
  `passwordLinkSentAt` column, so it holds across instances), plus per-IP
  throttles on request and confirm in the style of `lib/login-throttle.ts`.
  A definite `failed` releases the cooldown; `unknown` keeps it.
- **Availability:** the "Forgot password?" link on `/login` and the endpoints
  exist only when `mailEnabled()` and a base URL are present; otherwise the
  endpoints answer 404 and the recovery path stays the admin reset and
  `scripts/reset-admin-password.js`.
- **Admins** can trigger the same link for a user from the drawer ("Send
  password link") instead of inventing a temporary password. Audited (U6).
- **Never logged:** links and tokens follow the credential rules: not in
  logs, error messages, audit payloads or the preheader.

**Tests (U7b/U7c):** the identical-answer rule (same status and body for
known, unknown and deactivated addresses; no query in the request, checked
with a Prisma query counter); token invalidation by each field; replay of a
used link; two concurrent confirms (only one succeeds); cooldown; throttle;
reset-required users can use the link; deactivated users get nothing; e2e
journey: invite a user through the mock webhook, open the link, set a
password, sign in.

**Documentation:** a "Mail" section in `DEPLOYMENT.md` and
`COOLIFY_DEPLOYMENT.md` (which secrets to set, how to test with the mock
webhook), the new variables in `ENV_SETUP.md`, the public pages and endpoints
in [security.md](../../security.md), and the outbox in AGENTS.md's architecture
section.

## Order and size

| Step | Package | Size | Depends on |
| --- | --- | --- | --- |
| 1 | U1 last seen (schema, write, poll exclusions, column) | S | — |
| 2 | U7a mail transport, env vars, outbox, mock webhook | M | — |
| 3 | U2 Team page overhaul (table, filters, sort, drawer, create modes) | M | U1 (U7a for the invitation mode) |
| 4 | U3 deactivation + last-admin lock | M | — |
| 5 | U3 identity and password rules (+ case-pair check script) | S–M | — |
| 6 | U7c password links (token, pages, forgot password) | M | U7a, U3 password policy |
| 7 | U7b invitations | S | U7c token and page |
| 8 | U4 CSV import | M–L | U3 rules, U7b |
| 9 | U5 sign out everywhere, lockout audit/unlock | S | U2 drawer |
| 10 | U6 per-user history, mail events, audit filters from URL | S | U2 drawer |

Steps 1, 2 and 4/5 can run in parallel. Each step: typecheck, lint, unit
tests, the integration suite, and for UI steps `npm run build` +
`npm run test:e2e` (see the handoff for commands). For every behaviour
change, show that the new integration test fails on the old code. Update
[security.md](../../security.md) and the "Authentication and authorization"
section of [AGENTS.md](../../../AGENTS.md) when the rules change.

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
5. **Resolved: invitation links and mailed temporary passwords.** Support
   generated temporary-password email for new accounts, with forced password
   change, as well as invitation links. See the maintainer revision above for
   workspace permissions and credential-delivery/recovery requirements.
6. **Credentials CSV download:** acceptable to offer generated passwords as a
   one-time browser download, or copy-only?
7. **Resolved: workspace admins only.** Last-seen visibility and invitation
   resending are restricted to workspace admins; supervisors cannot resend.
   Platform admins retain administrative access.
8. **SMTP fallback:** n8n only (no new dependency), or also SMTP via
   `nodemailer` for self-hosters?
9. **Link lifetimes:** invitations 72 hours, password links 60 minutes?
10. **The n8n secret:** reuse survey-hub's `N8N_EMAIL_WEBHOOK_SECRET` value, or
    issue classiflow its own so it can be rotated separately? (The workflow
    would need to accept both.)

## Out of scope

- Independent double annotation and anything that changes labelling.
- SSO/MFA (open W02 decision).
- Notification mails about work (assignments, comments, digests). The
  transport makes them possible later; they need their own plan and an
  opt-out.
- Organisation/project multi-tenancy or per-taxonomy permissions.
- Survey-hub's per-survey page permissions: classiflow's roles plus the
  supervisor tree are the access model ([security.md](../../security.md)).
