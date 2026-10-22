# Security model

How classiflow decides who may do what. Keep this in step with `lib/api-auth.ts`,
`lib/access.ts` and the integration tests in `tests/integration/`.

## Authentication and sessions

- Credentials sign-in with a username or an email address and a password,
  handled by Better Auth (`lib/auth.ts`, endpoints under `/api/auth/*`).
  Passwords are hashed by Better Auth (scrypt) and stored on the user's
  `credential` row in `Account`, never on `User`. Public sign-up and Better
  Auth's own account-changing endpoints are switched off (`disabledPaths`);
  accounts are created and changed only through `app/api/users`, the
  workspace member API, `POST /api/auth/reset-password` and the password-link
  endpoints below.
- Sessions are **database rows** (`Session`), identified by an HTTP-only
  cookie. Every check reads the session and its user from the database (no
  cookie cache), so:
  - a **deleted** user gets 401 on the next request (their sessions are
    deleted with them);
  - a **demoted or promoted** user is checked against the new role immediately,
    by pages and API alike;
  - an **admin-set password** deletes all of that user's sessions; a
    **self-service password change** deletes all of their other sessions;
  - a **banned** user (Better Auth admin plugin, admins only) cannot sign in and
    loses their sessions;
  - a user who **must reset their password** gets 403 `PASSWORD_RESET_REQUIRED`
    everywhere except `POST /api/auth/reset-password`.
- `proxy.ts` guards **pages** with the same database-backed session (sign-in
  redirect, password-reset redirect) and sets the Content-Security-Policy. It
  lets every `/api` request through apart from a cross-site check, so every API
  handler starts with `requireSession()` / `requireSession('admin', …)` from
  `lib/api-auth.ts`. Public exceptions: `/api/health`, Better Auth's routes
  under `/api/auth/[...all]` (sign-in, sign-out, session) and the token-gated
  password-link and invitation endpoints (below). The pages `/forgot-password`,
  `/set-password` and `/invitation` work signed out.
- Server pages under `app/` load data through `lib/server/*`, which apply the
  caller's scope the same way the API does; admin pages redirect other roles
  (`lib/server/page-user.ts`).
- Sign-in is rate limited per client IP: `SIGN_IN_RATE_LIMIT` attempts a minute
  (default 10), counted in the `RateLimit` table so every instance shares it.
  Better Auth enables it in production only. Unknown usernames are still hashed
  against, so timing does not reveal which accounts exist.
- Content-Security-Policy is enforced with a per-request nonce for scripts
  (`proxy.ts`); styles allow `'unsafe-inline'` for React style attributes.

## Mail, password links and invitations

Only when mail is configured (ENV_SETUP.md "Email"; `lib/mail/`).

- **Password links** (forgotten password, an admin's "Send password link", and
  the invitation of a new account): a random secret in the URL **fragment**
  (`/set-password#t=…`), so it never reaches a server log, the proxy or a
  `Referer`; only its SHA-256 is stored (`Verification`, `lib/account-links.ts`).
  Opening the page only checks the link (a mail scanner cannot use it up);
  setting the password locks the account row, applies the password policy,
  refuses the current password, deletes every link and session of the account
  and signs nobody in. A link dies when used, after `PASSWORD_RESET_LINK_MINUTES`
  (invitations `INVITATION_LINK_HOURS`), when the password is set or sessions are
  revoked, when the email changes, or when the account is banned.
- **Forgot password** answers the same for every well-formed address and looks
  nothing up during the request (the lookup and the mail run after the
  response), so neither the answer nor its timing reveals accounts. One link
  per account per 15 minutes, across instances. Public endpoints are rate
  limited per client IP in the database (`lib/rate-limit.ts`).
- **New accounts** can be created with an invitation link (no password until
  the person chooses one; signing in fails until then) or a generated temporary
  password sent by mail: generated on the server, kept only in memory until it
  is sent after the account commits, never stored, logged, audited or retried.
- **Workspace invitations** go to an email address, whatever accounts exist, and
  the answer is the same either way: a workspace admin cannot probe for
  accounts. Accepting needs the signed-in account whose email matches, and
  re-checks at that moment that the workspace is active and the inviter is
  still its admin (or a platform admin). Inviting never resets or mails a password. A holder of a valid invitation
  who has no account may choose a name and password at `/api/invitations/setup`;
  the account, membership and invitation acceptance commit together. An existing
  identity must sign in instead and its credentials are never replaced. A resend replaces the link; withdrawing kills it.
- **Changing an email** follows the local-account rule below; the old address
  gets a notice and open links of the account end. The audit entry holds no
  addresses.
- Mail bodies, links, tokens and passwords never go into `OutgoingMail`, logs,
  audit payloads or error details.

## Workspaces

Everything except accounts lives in a **workspace** (an independently managed
classification exercise): records, imports, taxonomies, labels, suggestions,
comments, assignments, AI jobs and workspace audit entries. A person's role
(`admin`, `supervisor`, `labeller`) and supervisor are per workspace
(`WorkspaceMembership`); one person can be an admin in one workspace and a
labeller in another. Suspended memberships grant nothing.

**Platform admins** (`User.role = admin`) create workspaces, manage accounts
and may enter every workspace, where they act as its admin (authority
`platform`, shown in the UI). Nobody else learns that a workspace exists unless
they are an active member: an inaccessible workspace answers **404**, a
forbidden action in an accessible one **403**.

Isolation is enforced three times:

1. **Composite foreign keys** `(workspaceId, id)`: a label, comment,
   assignment or suggestion can only point at a record and taxonomy of the
   same workspace; assignments point at memberships of that workspace.
2. **Application scope:** handlers under `/api/workspaces/[workspaceId]` run
   through `workspaceRoute()` (`lib/api-auth.ts`) inside `withWorkspace()`
   (`lib/workspace/db.ts`); a query extension adds `workspaceId` to every
   query and insert on workspace tables.
3. **Row-level security** in PostgreSQL: the transaction-local
   `app.workspace_id` decides what the runtime role (`APP_DB_USER`) can read
   and write; without it, workspace tables are empty and unwritable. Covered
   by `tests/integration/db-runtime-role.test.ts`.

A few narrow database functions run as the schema owner, outside row
security, and are granted to the runtime role alone: `app_recoverable_ai_jobs()`
returns the ids and workspaces of AI jobs to recover, `app_admit_ai_jobs()` and
`app_release_ai_leases()` change only AI job status and lease columns,
`app_prune_audit_log()` deletes only audit entries older than a given time
(retention), and `app_search_sentences()`
(queue text search through the trigram indexes, which row security would
otherwise keep from the runtime role) returns ids of records **of the current
transaction's workspace only**, nothing outside a workspace transaction. The
caller loads the records through row security and the record scope as usual.

Archived workspaces are read-only: writes get 409, AI jobs were cancelled
(also at the AI service) when the workspace was archived, and a late AI result
is not stored.

## AI connections

- **Endpoints:** a workspace can only talk to an AI service a platform admin
  approved (`AIEndpoint`); workspace admins choose one, they cannot enter a URL,
  so workspace settings cannot reach arbitrary hosts from the server. Requests
  do not follow redirects. Retired endpoints take no new connections or jobs.
- **Credentials** are per workspace connection version, write-only: sent once
  by a workspace admin, encrypted at rest with AES-256-GCM
  (`lib/ai-credentials.ts`, keys in `AI_CREDENTIALS_KEYS`, bound to their row),
  never returned by an API, written to a log, an audit payload or a job row.
  A replaced version's credential is erased once no job uses it.
- **Namespaces:** every request names `<AI_SOURCE_SLUG>--<workspaceId>`, so
  workspaces never train or query the same model at classiflow's end. Whether
  Taxomind enforces that separation for one credential is not verified yet
  (release gate in docs/archive/plans-2026-10/workspace-isolation.md).
- **Jobs** keep the connection version they started with; results are stored
  only for the job's recorded input records, and only while the workspace is
  active. Cross-workspace job functions (recovery, admission, lease release)
  return ids only.

## Record visibility

`lib/access.ts` is the single definition inside a workspace, used by the
queue, stats, record detail, annotations, bulk labels, comments, flags,
assignments, member directory and progress endpoints:

| Workspace role | Records visible | Members visible |
| --- | --- | --- |
| admin (incl. platform admins) | all of the workspace | all |
| supervisor | assigned to their membership or any membership below it in this workspace's tree, at any depth | themselves and that subtree |
| labeller | assigned to their membership | themselves |

**Writes need the same visibility as reads.** Bulk requests are all-or-nothing:
one record outside the caller's scope (including a record of another
workspace, also for admins) rejects the whole request with 403 and changes
nothing.

The supervisor tree is walked breadth-first (the progress reports use a
recursive query with the same rules) with a cycle guard and a depth limit
of 25. The member API refuses supervisor links that would create a cycle,
self-supervision, or a labeller as supervisor. Changes that could remove the
last admin of a workspace (or the last platform admin) are serialised and
refused.

### Double annotation

Records in an active double-annotation round (`lib/server/double-annotation.ts`)
narrow what some people may see and do, on top of record visibility:

| Who | Sees | May write |
| --- | --- | --- |
| One of the round's two labellers (any role) | only their own answer and their own comments; no AI suggestions, no other labels, no last editor; label/AI queue filters skip the record; their queue tabs follow their own part | their own answer, once per taxonomy (final); skip their part; comments |
| A labeller with access who is not in the round | no labels | nothing but comments and flags |
| Admin not in the round | both answers, outcome, people | review decisions, accept single label, stop, hand over a part |
| Supervisor not in the round | the same, when both labellers are in their subtree | the same; otherwise read-only (a person outside the team needs an admin) |

Nobody reviews a round they label in. Bulk labels and bulk skips refuse a
selection that contains an active round (409). The progress overview's
double-annotation figures (agreement included) are null for labellers.

## Access matrix

Paths below are relative to `/api/workspaces/[workspaceId]` unless they start
with `/api/`. `member` = an active member of the workspace (or a platform
admin) with a valid session who does not have to reset their password.
"In scope" = the record is visible under the table above.

| Endpoint | Methods | Who |
| --- | --- | --- |
| `/api/health` | GET | public (DB connectivity only) |
| `/api/auth/[...all]` | * | public (Better Auth: sign-in, sign-out, session; admin-plugin endpoints need the platform admin role) |
| `/api/auth/reset-password` | POST | signed in, including users who must reset |
| `/api/auth/forgot-password` | POST | public, rate limited; 404 without mail |
| `/api/auth/set-password/check`, `/confirm` | POST | public, rate limited; needs a valid password link |
| `/api/invitations/check` | POST | public, rate limited; needs a valid invitation link |
| `/api/invitations/accept` | POST | signed in as the invited address |
| `/api/system/mail` | GET | platform admin (mail on/off, base URL; no secrets) |
| `/api/workspaces` | GET | signed in; lists only workspaces the caller may enter |
| `/api/workspaces` | POST | platform admin (creates the workspace and its first admin) |
| `/api/workspaces/[workspaceId]` | GET | member |
| `/api/workspaces/[workspaceId]` | PUT (rename, archive, reopen) | workspace admin |
| `/api/users`, `/api/users/[id]` | all | platform admin (accounts: platform role, email, temporary password, ban, delete) |
| `/api/ai-endpoints`, `/api/ai-endpoints/[id]` | GET, POST, PUT (which workspaces may use it), DELETE (retire) | platform admin |
| `/sentences`, `/sentences/stats` | GET | member; results limited to scope |
| `/sentences/[id]` | GET | member; record in scope |
| `/sentences/[id]/annotations`, `/flag` | POST | member; record in scope |
| `/sentences/[id]/comments` | GET, POST, PATCH (resolve) | member; record in scope |
| `/sentences/[id]/comments` | DELETE | record in scope **and** (comment author or admin) |
| `/sentences/bulk-label` | POST | member; **every** record in scope; none in an active double-annotation round when labelling or skipping |
| `/sentences/double-annotation` | POST (preview with `dryRun`, start) | admin, supervisor; every record in scope and both people in the caller's team |
| `/sentences/[id]/double-annotation` | POST (accept single, stop, hand over) | admin, supervisor; record in scope, not one of its labellers, both labellers in the caller's team (admins: any) |
| `/sentences/assign` | GET, POST, DELETE | admin, supervisor; every record in scope and every target member in the caller's team |
| `/sentences/import`, `/imports/[id]` DELETE | POST, DELETE | admin |
| `/imports`, `/taxonomies`, `/taxonomies/active`, `/taxonomies/[key]/nodes` | GET | member |
| `/taxonomies` and `/taxonomies/[key]/*` writes | POST, PUT, DELETE | admin |
| `/users` | GET | admin (all members), supervisor (own team) |
| `/users` | POST | admin (new account + membership; access by handed-over password, invitation link or emailed password); adding an existing account directly: platform admin |
| `/users/import`, `/users/import/[id]`, `/users/import/template` | POST, GET | admin (CSV member import: new accounts only) |
| `/users/export` | GET | admin (every member of this workspace as CSV; no secrets) |
| `/users/[id]/mail` | POST | admin (not supervisors); password link or invitation resend, local-account rule |
| `/invitations`, `/invitations/[id]` | GET, POST, DELETE | admin (invite an email address, resend, withdraw) |
| `/users/[id]` | GET | self, admin, or supervisor of that member |
| `/users/[id]` | PUT, DELETE | admin; role, supervisor, suspension (DELETE suspends). Name, email and password only for accounts that belong to this workspace alone and never signed in (the local-account rule), otherwise platform admin |
| `/export` | GET (`labels=confirmed`, `format=details`) | admin; re-checked before every page of the stream |
| `/progress/overview`, `/progress/activity` | GET | member; workload and activity in the caller's scope. `personId` / `teamId` narrow it and get 403 when outside the scope (labellers: only themselves, no team) |
| `/progress/people` | GET | admin, supervisor (own subtree); same selector rule. Admins' unrestricted view also lists platform admins who labeled here without a membership |
| `/progress/members` | GET | admin, supervisor; picker search within the caller's scope (names and roles only); a `teamId` outside it is a 403 |
| `/ai-labeling/*`, `/ai-jobs/*`, `/ai-settings`, `/ai-settings/connection`, `/audit` | all | admin (credentials write-only) |

## Known gaps

Open items are in [open items](plans/open-items.md). Cross-site mutation
checks, security headers and the audit trail (DEPLOYMENT.md "Audit log", which
also records refused access) are in place. Still depending on the deployment:
upload size limits, HSTS and login rate limiting at the reverse proxy.

## Global Team directory

`/team` is platform-admin-only and `/accounts` redirects there. A person has
one global identity identified by normalized email, and separate workspace
memberships. Platform admins can edit those memberships from the user profile
or enter a workspace's member page from `/workspaces`. Standard users cannot
browse global accounts. New account forms may omit username; a random unique
legacy alias is generated and email sign-in works as before. Adding an existing
active member again is idempotent and never changes their role or password.
Removed memberships must be explicitly restored; their IDs and history remain.
