# Security model

How classiflow decides who may do what. Keep this in step with `lib/api-auth.ts`,
`lib/access.ts` and the integration tests in `tests/integration/`.

## Authentication and sessions

- Credentials sign-in with a username or an email address and a password,
  handled by Better Auth (`lib/auth.ts`, endpoints under `/api/auth/*`).
  Passwords are hashed by Better Auth (scrypt) and stored on the user's
  `credential` row in `Account`, never on `User`. Public sign-up and Better
  Auth's own account-changing endpoints are switched off (`disabledPaths`);
  accounts are created and changed only through `app/api/users` and
  `POST /api/auth/reset-password`.
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
  `lib/api-auth.ts`. Public exceptions: `/api/health` and Better Auth's routes
  under `/api/auth/[...all]` (sign-in, sign-out, session).
- Server pages under `app/` load data through `lib/server/*`, which apply the
  caller's scope the same way the API does; admin pages redirect other roles
  (`lib/server/page-user.ts`).
- Sign-in is rate limited per client IP: `SIGN_IN_RATE_LIMIT` attempts a minute
  (default 10), counted in the `RateLimit` table so every instance shares it.
  Better Auth enables it in production only. Unknown usernames are still hashed
  against, so timing does not reveal which accounts exist.
- Content-Security-Policy is enforced with a per-request nonce for scripts
  (`proxy.ts`); styles allow `'unsafe-inline'` for React style attributes.

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
  (release gate in docs/plans/workspace-isolation.md).
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

The supervisor tree is walked breadth-first with a cycle guard and a depth limit
of 25. The member API refuses supervisor links that would create a cycle,
self-supervision, or a labeller as supervisor. Changes that could remove the
last admin of a workspace (or the last platform admin) are serialised and
refused.

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
| `/api/workspaces` | GET | signed in; lists only workspaces the caller may enter |
| `/api/workspaces` | POST | platform admin (creates the workspace and its first admin) |
| `/api/workspaces/[workspaceId]` | GET | member |
| `/api/workspaces/[workspaceId]` | PUT (rename, archive, reopen) | workspace admin |
| `/api/users`, `/api/users/[id]` | all | platform admin (accounts: platform role, temporary password, ban, delete) |
| `/api/ai-endpoints`, `/api/ai-endpoints/[id]` | GET, POST, DELETE (retire) | platform admin |
| `/sentences`, `/sentences/stats` | GET | member; results limited to scope |
| `/sentences/[id]` | GET | member; record in scope |
| `/sentences/[id]/annotations`, `/flag` | POST | member; record in scope |
| `/sentences/[id]/comments` | GET, POST, PATCH (resolve) | member; record in scope |
| `/sentences/[id]/comments` | DELETE | record in scope **and** (comment author or admin) |
| `/sentences/bulk-label` | POST | member; **every** record in scope |
| `/sentences/assign` | GET, POST, DELETE | admin, supervisor; every record in scope and every target member in the caller's team |
| `/sentences/import`, `/imports/[id]` DELETE | POST, DELETE | admin |
| `/imports`, `/taxonomies`, `/taxonomies/active`, `/taxonomies/[key]/nodes` | GET | member |
| `/taxonomies` and `/taxonomies/[key]/*` writes | POST, PUT, DELETE | admin |
| `/users` | GET | admin (all members), supervisor (own team) |
| `/users` | POST | admin (new account + membership); adding an existing account: platform admin |
| `/users/[id]` | GET | self, admin, or supervisor of that member |
| `/users/[id]` | PUT, DELETE | admin; role, supervisor, suspension (DELETE suspends). Name and password only for accounts that belong to this workspace alone and never signed in, otherwise platform admin |
| `/export` | GET | admin; re-checked before every page of the stream |
| `/progress/stats`, `/timeline` | GET | member; limited to own work (labeller) or team (supervisor) |
| `/progress/team` | GET | admin, supervisor (own team) |
| `/ai-labeling/*`, `/ai-jobs/*`, `/ai-settings`, `/ai-settings/connection`, `/audit` | all | admin (credentials write-only) |

## Known gaps

Open items are in the [modernization plan](plans/modernization-2026-10.md)
("Carried over from hardening"). Cross-site mutation
checks, security headers and the audit trail (DEPLOYMENT.md "Audit log", which
also records refused access) are in place. Still depending on the deployment:
upload size limits, HSTS and login rate limiting at the reverse proxy.
