# Security model

How classiflow decides who may do what. Keep this in step with `lib/api-auth.ts`,
`lib/access.ts` and the integration tests in `tests/integration/`.

## Authentication and sessions

- Credentials login (username or email + bcrypt password), JWT sessions (Auth.js v5).
- `middleware.ts` only guards **pages**. It lets every `/api` request through, so
  every API handler starts with `requireSession()` / `requireSession('admin', …)`
  from `lib/api-auth.ts`. Public exceptions: `/api/health` and the Auth.js
  protocol routes under `/api/auth/[...nextauth]`.
- The JWT only proves who signed in. On every API call `requireSession()` reads
  the user's current `role`, `mustResetPassword` and `sessionVersion` from the
  database, so:
  - a **deleted** user gets 401 on the next request;
  - a **demoted or promoted** user is checked against the new role immediately;
  - a **password change** (self-service reset or admin-set password) increments
    `sessionVersion`, which signs out every session issued before it (401);
  - a user who **must reset their password** gets 403 `PASSWORD_RESET_REQUIRED`
    everywhere except `POST /api/auth/reset-password`.
- Page-level role checks (admin pages) still read the JWT role. A demoted admin
  may see an admin page shell until they sign in again, but every API behind it
  refuses them.
- Failed logins are throttled per identifier: 5 failures in 15 minutes lock that
  identifier for 15 minutes (`lib/login-throttle.ts`). This state is in process
  memory (reset on restart, not shared between instances); put a rate limit on
  the reverse proxy for public deployments. Unknown usernames are compared
  against a dummy hash so timing does not reveal which accounts exist. Login logs
  do not include the identifier.

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
| `/api/auth/[...nextauth]` | * | public (Auth.js protocol) |
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
