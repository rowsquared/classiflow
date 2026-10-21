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

## Record visibility

`lib/access.ts` is the single definition, used by the queue, stats, record
detail, annotations, bulk labels, comments, flags, assignments, user directory
and progress endpoints:

| Role | Records visible | Users visible |
| --- | --- | --- |
| admin | all | all |
| supervisor | assigned to themselves or anyone below them in the supervisor tree, at any depth | themselves and that subtree |
| labeller | assigned to themselves | themselves |

**Writes need the same visibility as reads.** Bulk requests are all-or-nothing:
one record outside the caller's scope rejects the whole request with 403 and
changes nothing.

The supervisor tree is walked breadth-first with a cycle guard and a depth limit
of 25. The user API refuses supervisor links that would create a cycle,
self-supervision, or a labeller as supervisor.

## Access matrix

`any` = any signed-in user with a valid session who does not have to reset their
password. "In scope" = the record is visible under the table above.

| Endpoint | Methods | Who |
| --- | --- | --- |
| `/api/health` | GET | public (DB connectivity only) |
| `/api/auth/[...all]` | * | public (Better Auth: sign-in, sign-out, session; admin-plugin endpoints need the admin role) |
| `/api/auth/reset-password` | POST | signed in, including users who must reset |
| `/api/sentences` | GET | any; results limited to scope |
| `/api/sentences/stats` | GET | any; counts limited to scope |
| `/api/sentences/[id]` | GET | any; record in scope |
| `/api/sentences/[id]/annotations` | POST | any; record in scope |
| `/api/sentences/[id]/comments` | GET, POST, PATCH (resolve) | any; record in scope |
| `/api/sentences/[id]/comments` | DELETE | record in scope **and** (comment author or admin) |
| `/api/sentences/[id]/flag` | POST | any; record in scope |
| `/api/sentences/bulk-label` | POST | any; **every** record in scope |
| `/api/sentences/assign` | GET, POST, DELETE | admin, supervisor; every record in scope and every target user in the caller's team. DELETE without `userIds` only removes the caller's team. |
| `/api/sentences/import` | POST | admin |
| `/api/imports` | GET | any (queue import filter) |
| `/api/imports/[id]` | DELETE | admin |
| `/api/taxonomies`, `/active`, `/[key]/nodes` | GET | any |
| `/api/taxonomies` | POST | admin |
| `/api/taxonomies/[key]` | PUT, DELETE | admin |
| `/api/taxonomies/[key]/import`, `/restore`, `/sync-ai`, `/validate` | POST | admin |
| `/api/users` | GET | admin (all), supervisor (own team) |
| `/api/users` | POST | admin |
| `/api/users/[id]` | GET | self, admin, or supervisor of that user |
| `/api/users/[id]` | PUT, DELETE | admin; cannot demote the last admin or delete oneself |
| `/api/export` | GET | admin |
| `/api/progress/stats`, `/timeline` | GET | any; limited to own work (labeller) or team (supervisor) |
| `/api/progress/team` | GET | admin, supervisor (own team) |
| `/api/ai-labeling/*`, `/api/ai-jobs/*` | all | admin |
| `/api/audit` | GET | admin |

## Known gaps

Open items are in the [modernization plan](plans/modernization-2026-10.md)
("Carried over from hardening"). Cross-site mutation
checks, security headers and the audit trail (DEPLOYMENT.md "Audit log", which
also records refused access) are in place. Still depending on the deployment:
upload size limits, HSTS and login rate limiting at the reverse proxy.
