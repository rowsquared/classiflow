# Isolated classification workspaces

**Status:** implementation proposal, 21 October 2026. No workspace feature changes
implemented. **Reviewed baseline:** classiflow `fae270f`; SurveyHub `4bfe9bc`.
The modernization work is concurrent: recheck its landed code before starting
implementation. This document does not change that workstream's files.

## Implementation status (handover, 21 October 2026)

Work in progress on branch `feat/workspace-isolation` (not merged; `staging`
is green without it). Built on the landed modernization (Next 16, Prisma 7,
Better Auth, `lib/server/*`).

**Done (server side, typechecks):**

- **P1 schema:** `prisma/schema.prisma` and the baseline migration
  `20261021120000_init` (still a fresh start, so folded into it): `Workspace`,
  `WorkspaceMembership` (role, status, same-workspace supervisor tree, unique
  `(workspaceId, userId)`), global `User.role` is now the platform role
  (`admin | user`, also Better Auth's admin-plugin role), `workspaceId` on every
  workspace table, composite `(workspaceId, id)` foreign keys (synonym → node
  also by taxonomy), `Sentence.recordKey` unique per workspace (CSV `id`, or a
  generated UUID), taxonomy keys unique per workspace, assignments reference
  memberships, `AuditLog.workspaceId` (null = platform event).
- **Row security:** policies on all workspace tables and `AuditLog`,
  `app_current_workspace()` from the transaction-local `app.workspace_id`,
  `app_recoverable_ai_jobs()` (SECURITY DEFINER, ids only, granted to the
  runtime role by `scripts/db-runtime-role.ts`). Policies are enabled, not
  forced: the schema owner (migrations, recovery function) is exempt; the
  runtime role is bound.
- **Scoped access, three layers:** `lib/workspace/db.ts` — `withWorkspace()`
  opens a transaction, sets `app.workspace_id`, takes a share lock on an active
  workspace for writes, exposes `db()` via AsyncLocalStorage and runs
  `afterCommit()` callbacks; a Prisma query extension adds `workspaceId` to
  every query and create on workspace models (so superuser dev/test databases
  behave like production); plus composite FKs and RLS.
- **P2 authorization:** `lib/api-auth.ts` — `requireSession()` (identity +
  platform role), `requirePlatformAdmin()`, `requireWorkspace(id, ...roles)`
  (404 for inaccessible workspaces, platform admins act as admin with
  authority `platform`), `reloadWorkspaceUser()`, and `workspaceRoute(roles,
  handler, { transaction, timeoutMs })` which runs a handler in its workspace
  transaction and refuses writes on archived workspaces (409).
  `lib/access.ts` works on memberships; admins no longer skip record checks.
  `lib/user-rules.ts`: workspace supervisor validation, advisory-locked
  last-admin checks for workspaces and the platform.
- **P3 routes:** all data APIs moved to `/api/workspaces/[workspaceId]/…`
  (sentences, taxonomies, imports, export, progress, ai-labeling, ai-jobs,
  audit, users = members). The API keeps speaking user ids; memberships are
  internal. Export streams in short re-authorised transactions per page and
  exports `recordKey` as `id`. AI jobs launch after commit; the monitor runs
  every step in the job's workspace and sends `sourceSlug =
  AI_SOURCE_SLUG--<workspaceId>` (`aiSourceSlug()`, AI_SOURCE_SLUG now
  required with AI). Taxonomy AI sync uses short transactions around the HTTP
  call. Taxonomy creation is serialised per workspace (advisory lock, limit
  of three per workspace).
- **Control plane:** `/api/workspaces` (accessible list; platform admins
  create with a first admin), `/api/workspaces/[id]` (rename, archive/reopen —
  archival takes an exclusive lock and cancels active AI jobs),
  `/api/users[/id]` = platform account administration (platform role,
  temporary password, ban, delete with FK-based 409). Workspace admins may
  reset password/name only for accounts that belong to their workspace alone
  and never signed in; adding an existing account is platform-admin only
  until invitations exist (user-management U7b).

- **P5 pages (first cut):** pages under `app/w/[workspaceId]/` with a
  workspace layout (access check per request, 404 otherwise, archived
  banner, `WorkspaceProvider`, sidebar with workspace name/role and "Switch
  workspace"); `/` sends single-workspace users to their queue, others to
  `/workspaces` (chooser; platform admins create workspaces there). Server
  pages load through `lib/server/*` inside `withWorkspace()`. Client calls use
  `workspaceApi()` / `workspaceHref()` / `useWorkspacePaths()`
  (`lib/workspace/urls.ts`); roles in the UI come from the workspace, not the
  session. App code typechecks.

- **Tests:** the integration suites run on explicit workspaces
  (`createWorkspace()`/`selectWorkspace()`, `createUser()` adds a membership,
  `params()` adds the workspace, `inWorkspace()` for direct inserts). New:
  `workspace-isolation.test.ts` (same taxonomy key in two workspaces, 404 for
  non-members, foreign record ids refused, mixed bulk requests refused,
  per-workspace roles, platform admins, archived = read-only) and a row
  security test against the real runtime role in `db-runtime-role.test.ts`.
  67 integration, 42 unit and 10 browser tests pass locally; typecheck,
  lint (0 errors) and the production build pass.

**Not done yet (next steps, in order):**

1. ~~e2e~~ done: the seed creates workspace `e2e-workspace`; all 10
   journeys pass against a production build.
2. **Run the integration app client as the runtime role** (today only the
   dedicated RLS test does), so every suite exercises row security.
3. **UI polish:** Team page shows member status and suspended members
   (API returns `status`), platform-only actions (adding existing accounts,
   password reset for shared accounts) are not surfaced yet; a platform
   accounts page (`/api/users`) has no UI yet.
4. **Docs:** AGENTS.md, docs/security.md (access matrix by workspace role),
   ENV_SETUP (AI_SOURCE_SLUG required with AI), DEPLOYMENT (runtime role
   mandatory in production, RLS), user-management plan rework (see below).
5. Later packages: P4 invitations (with user management U7), P6 per-workspace
   AI connections and job input tables, P7 lifecycle polish. External AI
   cancellation on archive is not sent yet.

## Recommendation and agreed requirements

Add **Workspaces** to one classiflow deployment. A workspace is an independently
managed classification exercise. Keep teams inside workspaces as a way to
distribute that exercise's records. Teams cannot provide the required isolation
today. There is no Project entity, project membership or project administrator
role in this proposal.

For example:

```text
One deployment and login
├── Workspace: Country A - Occupation coding
│   └── Own records, taxonomies, members, roles, settings and AI learning
├── Workspace: Country A - Expenditure coding
│   └── Own records, taxonomies, members, roles, settings and AI learning
└── Workspace: Business classification
    └── Own records, taxonomies, members, roles, settings and AI learning
```

Workspaces are a general product concept, not entities tied to countries or
statistics offices. Related workspaces may contain the same people, different
people, or overlapping teams. The same people can have different roles.
Different people are a reason to separate workspaces, but separate datasets,
taxonomies or learning histories are equally good reasons.

The user confirmed:

- Records, taxonomies, AI configuration and administrators must be isolated.
- One login can belong to several workspaces and have different roles.
- Workspaces alone are sufficient; an umbrella Project layer is not required.
- Platform administrators may access every workspace's records.

Workspace administrators administer only the workspaces where they hold an
administrator membership. The same person can administer several workspaces
through separate grants. Related exercises can use a naming convention now;
optional tags or visual grouping can come later without changing permissions.

Use one workspace when classifications share records, access and completion
requirements: that workspace can contain several taxonomies. Use separate
workspaces for independently managed exercises, even if the people overlap.
All active taxonomies in a workspace contribute to its completion requirements.

## What the current application actually separates

The review followed the schema, authorization helpers, routes, server pages,
exporter and AI monitors. Source code takes precedence over older guide text;
in particular, single and bulk labeling already share completion rules through
`lib/annotation-status.ts` at the reviewed baseline.

| Area | Current implementation | Consequence for independent exercises |
| --- | --- | --- |
| Identity and roles | `User.role` and `User.supervisorId` are global | A person cannot be an administrator in one exercise and a labeller in another |
| Record visibility | `lib/access.ts` limits supervisors to their subtree and labellers to assignments; admins get an unrestricted filter and bypass record checks | Teams help allocate records but provide no boundary for administrators |
| Taxonomies | Globally unique `Taxonomy.key`; creation counts all taxonomies against the limit of three | Exercises cannot independently use the same key, manage classifications or have their own limit |
| Completion | Single and bulk labeling load the deployment's active taxonomies | A second exercise's classification can affect what counts as complete |
| Imports | `GET /api/imports` lists every import to signed-in users | Filenames and import counts are shared even where record assignments differ |
| Record identifiers | Optional CSV `id` becomes the globally unique `Sentence.id` | Two exercises importing `000123` collide |
| Administration and export | Global admin role controls users, taxonomies, deletion, export, AI and audit | An administrator of one exercise also administers the others |
| AI | Module-level URL/key in `lib/ai-labeling.ts`; deployment-wide `AI_SOURCE_SLUG` | Separate teams do not establish separate AI connections or learning namespaces |
| Presentation | Global sidebar, queue, progress and administration routes | There is no explicit exercise context in links or settings |

Evidence: [schema](../../prisma/schema.prisma),
[record access](../../lib/access.ts), [session authorization](../../lib/api-auth.ts),
[security matrix](../security.md), [imports](../../app/api/imports/route.ts),
[taxonomy creation](../../app/api/taxonomies/route.ts),
[completion rules](../../lib/annotation-status.ts),
[record import](../../app/api/sentences/import/route.ts),
[CSV export](../../lib/export-csv.ts), [AI requests](../../lib/ai-labeling.ts),
[AI monitors](../../lib/ai-job-monitor.ts).

An import is an upload batch, not a workspace: it has no membership,
administration, taxonomy selection or AI settings. Renaming imports or making
one supervisor per engagement would leave the global behavior above intact.

## What to borrow from SurveyHub

The local SurveyHub source shows **one survey context with a selector**, rather
than a separate workspace entity above a survey. Its Surveys page centralizes
settings and access management. The picker lists accessible surveys, and shared
links carry the survey context. Per-survey page permissions are enforced in
the backend, with `NONE`, `VIEW`, `COMMENT` and `EDIT` levels.

Borrow the visible current context, a central management page, accessible
choices, links that identify their context, and protection against switching
with unsaved changes. One classiflow workspace corresponds to the independently
managed exercise; no additional grouping entity is needed.

Do not copy SurveyHub's storage and authorization structure wholesale. Its
entity data refers to survey names as strings, while permission rows reference
the Survey model. Names are not unique at the database level, and renaming
requires moving the matching data. Its administrators also bypass survey
permissions. classiflow should use immutable foreign-key IDs and distinguish
platform and workspace administration explicitly. Existing labeling
roles plus workspace membership are sufficient; page-by-page permission grids
would add complexity without an identified need.

SurveyHub sources reviewed, relative to its repository root:
`frontend/components/layout/SurveySelector.vue`,
`frontend/composables/useSurvey.ts`, `frontend/pages/surveys.vue`,
`backend/apps/surveys/models.py`, `backend/apps/surveys/views.py`,
`backend/apps/interviews/models.py`, `backend/core/permissions.py`, and
`docs/architecture/TABLES_AUTH.md` ("Links name their survey" and
"Authorization"). This was a source review, not a live production UI check.

## Architecture choices

| Option | Assessment |
| --- | --- |
| Existing teams or import filters | Insufficient: global classifications, roles, settings and administrators remain coupled |
| Workspaces in one database schema | **Recommended:** one deployment, shared login, explicit ownership, independently scoped workflows and one membership layer |
| Project plus isolated workspaces | Adds shared delegated administration, but also another membership layer, permission inheritance and lifecycle rules; not needed for the agreed use cases |
| PostgreSQL schema per workspace | Repeats migrations and complicates dynamic Prisma access; shared identity and workspace discovery still need separate design |
| Database per workspace behind one app | Stronger operational separation, but needs database provisioning, pool management, migration orchestration and workspace-specific recovery tooling |
| Separate deployment per engagement | Available today and appropriate when independent infrastructure is required; does not deliver the requested single application experience |

Keep Next.js, Prisma, PostgreSQL and the existing job lease design. The needed
rewrite is ownership and authorization across the application, not a framework
replacement. Use workspace foreign keys, database constraints, centralized
workspace-aware services and PostgreSQL row security together.

This provides application-level separation within shared infrastructure.
Platform administrators are deliberately privileged. Backups, database
operators, application capacity and deployments remain shared; workspace
isolation is not independent hosting or a per-workspace point-in-time restore.

## Ownership and schema

### Global identity and workspace membership

Introduce these application-owned models; names are illustrative, but the
ownership and constraints are requirements:

| Model | Main fields and rules |
| --- | --- |
| `User` | Global login identity and authentication state; `platformRole = admin | user`; no global labeling role or supervisor |
| `Workspace` | Immutable `id`, editable name/description, lifecycle status, timestamps |
| `WorkspaceMembership` | `id`, `workspaceId`, `userId`, `role = admin | supervisor | labeller`, active/suspended status, `supervisorMembershipId`, workspace-specific `lastSeenAt`; unique `(workspaceId, userId)` and `(workspaceId, id)` |
| `WorkspaceAIConnectionVersion` | Workspace owner, immutable endpoint/namespace configuration, encrypted credential, version and retirement state; jobs reference the version they use |

Workspace membership references its workspace and the global user identity.
The supervisor reference uses a composite foreign key to a membership in the
**same workspace**; preserve cycle, allowed-supervisor-role and depth checks in
a workspace-aware helper. Sharing a user does not share their role or tree.

Keep inactive memberships for attribution and history. Removing access does
not delete comments, labels or audit records. Suspending a workspace membership
affects only that workspace. Global account suspension remains a platform
action and affects every workspace where the person participates.

### Workspace-owned data

Add a non-null `workspaceId` to imports, records, taxonomies, nodes, synonyms,
taxonomy settings, annotations, suggestions, assignments, comments, labeling
jobs, learning jobs, and their input references. Audit events about workspace
data must also identify their workspace. Workspace is the only domain ownership
boundary; there is no parent project identifier to resolve or duplicate.

Required database invariants:

- Replace global taxonomy-key uniqueness with `(workspaceId, key)`. The limit
  of three taxonomies applies separately to each workspace. Serialize creation
  on its workspace row so concurrent requests cannot exceed the limit.
- Keep globally generated internal `Sentence.id` values. Add a required string
  `recordKey`: the CSV's supplied `id`, or a generated value when omitted.
  Enforce `(workspaceId, recordKey)` uniqueness. UI and CSV export show this
  key; URLs, relational joins and AI record identifiers use the internal ID.
  Keep leading zeros and scope dry-run duplicate detection to the workspace.
- Give referenced workspace entities a unique `(workspaceId, id)` pair and
  use composite foreign keys throughout. A record's import, an annotation's
  record and taxonomy, a suggestion's record and taxonomy, and a comment's
  record must all belong to the same workspace. Synonym references must also
  agree on taxonomy and node, not merely workspace.
- Assignments reference `(workspaceId, membershipId)`, not an arbitrary global
  user. Validate active status when assigning. A supervisor's tree consists
  of memberships in this workspace, never global user links.
- Human actor references may still point to global `User` identities: platform
  administrators can act without a direct workspace membership. Derive authors
  from authenticated server context, never submitted user IDs. Record the
  effective permission source in administrative audit.
- Snapshot job input records using typed labeling/learning job-input join
  tables with real workspace-aware foreign keys. Filter JSON may describe the
  request but must not be the authoritative unvalidated list of record IDs.

Workspace data cannot be moved by changing `workspaceId`. A future transfer
would need an explicit, validated copy workflow. There is no shared mutable
taxonomy between exercises in the initial release. Importing the same CSV into
two workspaces creates independent definitions, settings and learning history.

## Authorization model

| Grant | Scope and capabilities |
| --- | --- |
| Platform admin | Create/manage workspaces and global accounts; access every workspace; act as an effective workspace admin |
| Workspace admin | Manage that workspace's members, taxonomy, records, exports, AI and audit; see all its records |
| Workspace supervisor | Existing assignment, labeling and progress permissions for their workspace subtree |
| Workspace labeller | Existing labeling permissions for their own assignments within the workspace |

Platform administration is the only global override. An explicit labeller
membership does not downgrade a platform administrator; show the effective
role and its source in the UI. Otherwise the workspace membership determines
the role. Workspace administrators cannot grant platform administration or
gain another workspace through an invitation. For anyone without platform
administration, administering several workspaces requires a separate
administrator membership in each, without an implicit shared-administrator
group.

Separate authentication from domain authorization:

```ts
requireSession()                      // current identity and platform role
requirePlatformAdmin()                // global account/workspace management
requireWorkspace(workspaceId, capability)
// -> WorkspaceContext { userId, workspaceId,
//                      effectiveRole, authority, membershipId? }
```

Check current account, workspace and membership state on each request,
including server-rendered pages. A JWT, a session's remembered role or an
"active workspace" cookie is not the authorization source. Platform admins
still enter a specific workspace context; no default unscoped record query or
global export is implied by being an administrator.

Inside that context, compose two filters: **workspace ownership AND the
effective role's record visibility**. An admin's unrestricted record scope
means all records in this workspace. Remove the existing admin shortcut that
accepts any sentence IDs without checking ownership. Mixed-workspace bulk
requests fail as a whole, including for platform admins.

Return 404 for an inaccessible workspace or object; use 403 for a forbidden
action on an accessible workspace. Do not expose names, counts or validation
details from an inaccessible workspace. Revalidate permissions for each
streamed export batch and each new request after a role or membership change.
An already authorized transaction may finish; later requests/batches must see
the revocation. Long-running jobs belong to the workspace and can continue if
their creator leaves, unless the workspace is archived.

Keep at least one active platform administrator and one active direct workspace
administrator per active workspace. Membership changes, account suspension
and administrator transfers must lock the affected workspace rows in a
consistent order and check these rules together. Global administrator changes
also need a shared platform-level lock to serialize the last-admin check.
Global suspension that would break the invariants needs administrator transfers
in the same operation. Test concurrent demotions and suspending a person who
administers several workspaces.

## Database row security and service boundary

Make workspace row security a release requirement, in addition to explicit
application filters and composite constraints. PostgreSQL documents that
enabled row security defaults to denying access without an applicable policy,
and that owners and privileged roles can bypass it. Use a non-owner,
`NOBYPASSRLS` runtime role and test the actual deployed role.
([PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html))

Build on modernization M05's server modules. Workspace domain functions accept
a validated `WorkspaceContext` and a scoped transaction client. They must not
import the unscoped Prisma singleton. Infrastructure owns the singleton and a
`withWorkspaceTransaction(context, callback)` wrapper, including raw SQL.

Set workspace context with parameterized `set_config(..., true)` inside the
same Prisma interactive transaction that executes the queries; the setting
then lasts only for that transaction. Never use a connection-wide setting in
a pooled client. This is a proposed integration that needs a spike on the
landed Prisma/driver versions.
([PostgreSQL transaction-local settings](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET))

Policies must fence both reads and writes (`USING` and `WITH CHECK`), including
joins and raw locking queries. Ordinary workspace data access without context
must fail closed. Global auth and workspace/membership discovery need deliberately
separate control-plane methods: list only authorized workspaces and
safe member profiles. Document those bootstrap exceptions and test them; do
not add a generic application-visible bypass switch. Row security enforces
workspace ownership; record assignments and role capabilities remain service
rules. It does not protect against a compromised application choosing false
context or a privileged database operator.

Background recovery is the other explicit exception. It may discover a bounded
set of eligible job IDs and workspace IDs through a narrowly granted database
function, then claim, read and write each job in that workspace's transaction.
If a privileged function is used, fix its search path, owner and EXECUTE grants;
it must not return record contents. Do not give the web process `BYPASSRLS`.

Do not hold transactions open during Taxomind HTTP calls or CSV streaming.
Exports plan columns and fetch each batch through short, newly authorized
workspace transactions, retaining the existing bounded-memory behavior. Jobs
claim/update state in short transactions around the external request. Preserve
conditional leases, ordered record locks and cancellation guards. Add an
import/lint boundary check preventing workspace modules from bypassing these
entry points.

## Pages, navigation and settings

- `/workspaces` lists accessible workspaces and their permitted counts.
  Platform admins can create workspaces and assign the initial administrators.
  Ordinary members never see names, totals or members of inaccessible workspaces.
- `/w/[workspaceId]/queue`, `/progress`, `/taxonomies/[key]` and the existing
  administration screens make the workspace explicit in every link. Queue
  record links use internal IDs under the workspace route.
- Workspace APIs live under `/api/workspaces/[workspaceId]/...`.
  Global workspace discovery/creation and account management are control-plane
  operations with their own authorization.
  Existing unscoped data APIs must be removed or reject calls; never silently
  choose a workspace from a cookie.
- A header switcher lists accessible workspaces and shows the current
  **Workspace** plus the effective role. Even one workspace keeps a
  visible context label. The switcher is searchable and keyboard accessible.
- A central workspace settings area contains General, Members and teams,
  Taxonomies, and AI. Platform administration handles workspace creation and
  global accounts. Do not put a page-level permission matrix in v1.
- Workspace changes guard unsaved labels/forms, clear selection and dialogs,
  cancel requests, and remount workspace state. TanStack Query keys include
  workspace ID and permission scope; mutations invalidate only that workspace.
  Late responses must never populate the newly selected workspace.
- Saved filters and drafts are keyed by user and workspace. URLs are
  authoritative, so two tabs can use different workspaces concurrently.
  A remembered last workspace is a navigation convenience only. Explicit links
  to an inaccessible workspace show the access error, not a silent fallback.
- A user with no workspace access sees a useful access-request/empty state.
  A user with one goes directly to it; users with several get a chooser or a
  still-accessible remembered workspace. Login return URLs retain context.

Move workspace shell/providers below the workspace route layout. Keep global
identity outside it. Clear private query state on logout, account change and
access revocation; do not persist workspace responses in a shared cache.

## Labeling, taxonomies, imports and reporting

All current workflows remain available within a workspace: import, dry run,
assignment, single/bulk labeling, comments, flags, progress and streamed export.
No normal operation reads another workspace even if its caller belongs to both.

Both annotation paths must load **this workspace's** active taxonomies when
computing completion. Suggestions alone never complete records. Preserve leaf
and level-specific unknown-code validation, transactional saves, skipped and
escalated behavior, and learning counters. Taxonomy changes in Workspace B
must not alter statuses, learning thresholds or export columns in Workspace A.
Any recomputation after taxonomy activation/replacement stays workspace-bound.

Import batches stay inside a workspace; several uploads do not create several
workspaces automatically. Export retains existing columns and formula handling,
with CSV `id` now sourced from `recordKey`. Name downloads with workspace
context. A full export remains distinct from the existing record-import format;
this feature does not promise a new round-trip import or backup format.

Scope every nested relation and aggregate, including user assignment counts,
last editor, comment authors, progress timelines, agreement, filters, taxonomy
lookups, audit actors and AI job badges. Workspace member lists expose permitted
members' lean identities, not their other memberships or global activity.
Use workspace-specific last seen in workspace administration: activity in
another workspace must not make someone appear active here.

## Identity administration and the user-management plan

Global credentials and profile belong to the identity, while workspace
roles, supervisor links and removal belong to memberships. A workspace admin
may invite someone, change their local role, suspend local access or remove
local assignments. They may not reset an existing global account's password,
change its email, globally suspend it or sign it out across all workspaces.
Otherwise a local admin could take over the same person's other workspaces.

Rework [user management](user-management.md) before implementing its global
Team assumptions:

- **U1:** workspace activity must be separate from global session
  activity. Keep background polls excluded from workspace last-seen writes.
- **U2/U4:** the Team page and CSV bulk operations manage workspace memberships;
  supervisor references and counts are local. Do not offer an unrestricted
  global user directory.
- **U3/U5:** distinguish membership suspension from account bans and local
  access removal from global session revocation. Password/security actions on
  an existing identity are self-service or platform-admin operations.
- **U6:** scope history and audit browsing to the caller's administrative scope.
- **U7:** invitations name the workspace and intended role. Accepting
  requires the matching authenticated identity; inviting an existing user
  never resets their password or reveals their other memberships. Recheck the
  inviter's permission, target lifecycle and granted role at acceptance.

Provide a no-mail path as well: one-time invitation/setup handover, bound to
the intended identity and workspace. Temporary credentials can be issued for
a genuinely new, unused account, never substituted onto an existing shared
identity. Keep invitation responses from exposing global account existence.

Better Auth remains M04's identity/session system. Its organization plugin
already offers membership, invitations, roles and active-organization state,
so it is a credible alternative to some custom tables.
([Better Auth organization plugin](https://better-auth.com/docs/plugins/organization))
For this proposal, keep workspace membership application-owned: the supervisor
tree, local suspension and membership invariants need one consistent
transactional implementation. The single membership layer makes the plugin a
closer alternative than in a two-layer hierarchy. Use Better Auth
for global identity and sessions, with its admin capabilities restricted to
platform administration. Do not keep duplicate plugin and application
membership authorities. Revisit this choice in the foundation spike only if
the installed plugin can replace, rather than mirror, the proposed tables.

## Optional AI: isolate the connection and the learning history

An isolated UI is insufficient if two exercises still train the same model.
`sourceSlug` is currently deployment-scoped and sometimes omitted. Introduce a
stable namespace derived from **deployment namespace + immutable workspace ID**,
and pass it explicitly on taxonomy sync, labeling and learning. Require an
explicit deployment base namespace through `AI_SOURCE_SLUG` when enabling AI;
do not fall back to host inference. Friendly keys such as `isco` can repeat
across workspaces. Confirm Taxomind's accepted namespace format and length;
do not derive identity from editable names.

Refactor `lib/ai-labeling.ts` into a server-only client constructed from the
workspace's approved connection version. Remove its module-level shared
credentials. A workspace can disable AI, choose its approved connection,
configure thresholds and hold a distinct credential. Human labeling must work
when no connection exists or the service is unavailable.

Platform admins approve allowed outbound service endpoints; workspace
admins configure their connection against those approved endpoints. Validate
redirects and destinations so connection configuration cannot become arbitrary
server-side network access. For v1, store credentials in PostgreSQL using
authenticated encryption, with the encryption key supplied separately as a
deployment secret and a key-version identifier on the encrypted value. Use a
write-only credential API; never return the secret or put it into audit, job
filters, errors or logs. Prove key rotation and restore in P0, and document
separate recovery of the database and encryption key. This avoids adding a
secret-provider service. Legacy deployment-level URL/key settings must not
silently configure every new workspace.

Jobs persist workspace, taxonomy, immutable connection version, namespace,
input records and external job ID. Changing settings must not poll or cancel
an existing job against a different endpoint. Retain necessary old versions
until their jobs finish. Introduce a persisted taxonomy-sync job with the same
workspace context and lease discipline; the legacy sync monitor cannot keep
using a deployment-global client. Keep the existing labeling/learning job
tables and monitors' tested lease behavior rather than replacing the queue.

Recovery, polling, result validation, cancellation and learning counters must
all reconstruct scope from persisted job ownership, never a current browser
selection. Reject results outside the job's recorded workspace/input set.
Workspace archival blocks further result writes; removing the creator's
membership alone does not invalidate an already authorized workspace job.

Add basic per-workspace active-job limits and a deployment-wide ceiling, checked
atomically, plus fair selection of queued work across workspaces. Preserve
timeouts/backoff and avoid an unbounded connection/poll burst. This does not
require Redis or another queue service.

**External release gate:** this review did not inspect Taxomind internals or
verify its live model-storage authorization. A different namespace alone is
not proof of external isolation. Extend modernization M09 to test identical
taxonomy keys in two namespaces: sync, learning, prediction, status, cancel
and deletion must stay separate. Verify how credentials authorize namespaces.
If Taxomind cannot guarantee that, require separate approved Taxomind
connections/instances before enabling AI for independent workspaces. Human-only
workspaces can launch without that external gate.

## Lifecycle, audit and operations

Creating a workspace also creates its initial administrator membership and
default settings in one transaction. Default workspace settings are copied
values; later deployment defaults must not silently modify existing exercises.

Ship archival before permanent deletion. Archived workspaces are
readable to authorized users and reject labeling, imports, configuration
changes, invitations/acceptance and new AI jobs. Mark archival and block result
writes transactionally, then cancel queued jobs and request external
cancellation. A late response cannot reactivate work or save suggestions.
Archiving or reopening one workspace has no effect on any other workspace,
including those with the same administrators. Keep reopen controls limited to
platform administrators and that workspace's administrators.

Check lifecycle state inside each mutation transaction and coordinate with
archival through locks on the workspace row. Normal
data writes use shared locks so they can run concurrently; archival takes
exclusive locks and waits for those writes to finish. A transaction starting
after archival cannot save labels or AI results based on a stale context check.

Audit records distinguish platform events and workspace events
with validated scope. Membership changes, administrative overrides, invitations,
AI configuration and lifecycle actions record actor and effective authority.
Workspace audit readers must not see global security events or other exercises.
Important membership/permission changes and their audit entries should commit
together; the existing best-effort audit helper is insufficient for those
transitions. Do not put record contents or credentials into audit payloads.

Make the least-privilege runtime role mandatory for the isolated deployment;
today it is optional. Test its grants during startup/deployment. Migration and
backup credentials remain operational secrets. Keep backups as full deployment
backups and verify a restore includes every workspace under the correct role.
CSV export is not a workspace backup. A staging clone must use different AI
namespaces/credentials, with AI disabled until configured, to avoid training
or cancelling production jobs.

Keep upload/export limits, workspace query indexes and job ceilings
explicit. Load-test one busy workspace alongside an interactive second one.
Shared resource ceilings reduce interference but cannot guarantee independent
capacity; per-workspace database/infrastructure isolation can be added later
if that becomes a requirement.

## Coordination with modernization

Do not build a temporary workspace system on top of global roles and then port
it again. Coordinate these interfaces with the concurrent work; this proposal
does not edit its plan or assume its implementation is already present.

| Workstream | Required alignment |
| --- | --- |
| M01/M02 | Target the landed Next/Prisma APIs; validate scoped transactions and row security on the actual driver/pool |
| M04 | Identity/platform role stays global; labeling role and supervisor move to workspace membership; no intermediate administrator role |
| M05 | Server functions take workspace context and scoped clients from their first extraction; pages and APIs share those functions |
| M00 | Include the final workspace schema and row-security SQL in the fresh baseline if still before real data; do not reset any database merely because the old plan allowed it |
| M06 | Workspace-aware query keys, filters, navigation and cancellation; preserve existing stale-response protections |
| M07 | Add workspace-leading indexes for actual queue/progress/export queries, then measure representative loads |
| M08 | Redacted logs carry workspace IDs, and deployment checks verify runtime privileges |
| M09 | Explicit connection/namespace contracts and live isolation verification become prerequisites for shared-service AI |
| U1–U7 | Apply the identity/membership split above before implementing global account actions in a workspace Team page |

M04's promise to preserve `requireSession('admin')` callers cannot survive this
feature unchanged: every domain caller must move to workspace
authorization. Keep old behavior only for explicitly global endpoints while
the feature is developed; shipping both meanings of `admin` is not acceptable.

## Implementation sequence and acceptance gates

Sizes are relative review packages, not calendar estimates. This is a large,
cross-cutting feature. A switcher alone is not a releasable isolation feature.

| Package | Work | Size | Acceptance gate |
| --- | --- | --- | --- |
| P0: foundations | Reconcile landed modernization; record grant model; spike scoped Prisma transactions, RLS, export paging and background recovery | M | Demonstrate fail-closed access and connection reuse without context leakage; validate membership integration and credential encryption/rotation |
| P1: schema | Workspace/membership models, local supervisor tree, record keys, ownership columns, composite FKs, job inputs, indexes | L | Fresh database installs; cross-workspace relation attempts fail; duplicate CSV IDs/taxonomy keys work across workspaces |
| P2: authorization | Context resolver, platform override, membership management, last-admin locking, scoped transaction wrapper and RLS | L | Positive/negative integration matrix passes under runtime credentials; workspace roles never grant access to other workspaces |
| P3: domain conversion | Move every record/taxonomy/import/progress/export/audit operation and raw SQL into scoped services; convert single and bulk paths together | L | All existing labeling/import/export/access suites retain behavior within a workspace; full route inventory has no unscoped data path |
| P4: user administration | Workspace Team page, invitations/manual setup, local suspension, scoped activity/audit | L | Shared identities cannot be reset or globally disabled by local admins; invitation and concurrent-admin tests pass |
| P5: application shell | Workspace directory, chooser, switcher, settings, route moves, query keys and state reset | L | Two-tab, deep-link, stale-response, unsaved-work and role-change browser journeys pass |
| P6: AI | Versioned clients/connections, persisted sync context, scoped jobs/recovery/results, quotas and external contract checks | L | Restart/cancel/connection-change tests pass; live Taxomind isolation proven before AI is enabled |
| P7: lifecycle and release | Archival, scoped audit, runtime-role deployment, restore check, documentation and performance checks | M–L | All human-only release gates pass; no data-isolation gate is deferred |

P0 follows the relevant framework/ORM/auth foundations. P1–P3 precede production
exposure. UI work can use fixtures during P2–P4, but must not enable partially
converted APIs. A human-only release may ship after P7 with AI unavailable;
AI availability requires P6. Keep testing the same artifact on staging before
the existing production promotion process.

## Validation matrix

Use at least three independent workspaces. Reuse CSV IDs, taxonomy keys and
some people; include workspace-only members, different supervisors and roles
for one person, an administrator of two workspaces and a platform admin.

- **Every data route:** list/detail, filters, imports, taxonomy nodes/settings,
  single/bulk annotation, flags, all comment methods, assignments, progress,
  export, audit, AI job/history/status/cancel. Include guessed IDs, foreign
  taxonomy keys, nested relation leaks and mixed-workspace bulk requests.
- **Permissions:** a shared user has independent workspace roles and teams;
  workspace admins reach only their explicitly granted workspaces; administering
  A and B grants no access to C. Platform admins can reach all but still need
  explicit workspace scope.
  Revocation takes effect on the next request/export batch.
- **Database:** exercise FK failures and row security directly as runtime role,
  not only as schema owner. Test no context, wrong context, raw SQL, inserts,
  updates, connection reuse, rollback, parallel workspace requests and narrow
  discovery/recovery exceptions. Test the real pool configuration.
- **Behavior:** both labeling paths consider only local active taxonomies;
  human/suggestion separation, leading zeros, unknown labels, skipped/escalated
  records, replacement-orphan checks and learning counters remain correct.
  One workspace's taxonomy change leaves another's state unchanged.
- **Identity:** local suspension versus global suspension, invitations for
  existing accounts, replay/expired/revoked invitations, no-mail setup,
  last-admin races, supervisor cycles and no other-workspace activity disclosure.
- **Browser:** workspace switching, keyboard access, deep links after login,
  two tabs, back/forward navigation, no memberships, single workspace,
  membership removed while open, delayed old requests, cached counts, unsaved
  edits, selection and mutation invalidation.
- **AI:** two namespaces with identical keys; independent learning/suggestions;
  restart and lease takeover; archived scope; malformed/foreign results;
  endpoint changes while polling; cancellation; per-workspace/global ceilings;
  unavailable AI leaves human work usable.
- **Operations:** fresh deployment, real runtime credentials, full restore,
  production/staging namespace separation, archive with active jobs, streaming
  memory and representative concurrent workspace load.

Run typecheck, lint, unit/integration suites, production build and relevant
Playwright journeys. Update integration fixtures to create explicit scopes;
do not let test helpers silently put everything into one default workspace.
Add a failing regression case for each converted boundary before relying on
the implementation. Reconcile against the final route inventory, not a fixed
route count from an older architecture document.

## Deployment/data transition

The modernization plan says no data currently needs to be preserved; verify
that condition again at implementation time. If it still holds, build and
install one clean final baseline with the full ownership schema and policies.
Do not reset or squash a database that has since acquired real data.

If data does exist, use an explicit migration: create a legacy workspace,
map current users/roles/tree into memberships, populate ownership
on every child row, and copy existing record IDs into `recordKey` while retaining
their internal IDs. New imports use independently generated internal IDs.
Verify joins, counts, foreign keys and job input ownership before making
columns non-null or enabling row security. Do not split records into workspaces
automatically from assignments/imports: those do not express the intended
boundary.

Pause new writes and AI starts for the cutover, and drain/cancel old jobs before
changing external namespaces. Existing namespace-trained models need an
explicit supported transfer or re-sync/retraining, not an assumed rename.
Run a full restore rehearsal. A rollback after ownership changes requires the
matching database backup/application version, not just deploying old code.

Update AGENTS.md and `docs/security.md` when behavior changes; put settings in
`ENV_SETUP.md`, local fixtures in `DEVELOPMENT.md`, deployment/RLS/backup steps
in `DEPLOYMENT.md`, and release coordination in `COOLIFY_DEPLOYMENT.md`.

## Deliberate limits of the first implementation

No Project or organization entity above Workspace; no custom permission
builder; no shared mutable taxonomy or shared trained model across workspaces;
no automatic data moves; no per-workspace database provisioning, backup restore
or permanent-delete UI. A future reusable taxonomy library should copy or pin
an immutable version explicitly, without coupling existing exercise settings.

Related-workspace administration uses explicit memberships in each workspace.
An umbrella project/group permission model would be a separate future feature,
justified by a concrete need for delegated administration across a changing set
of workspaces. Naming conventions or optional future tags must not grant access
or couple lifecycle, taxonomies or AI learning.

Platform-wide administrator access, one workspace membership layer and separate
workspace data/teams/roles/AI are confirmed requirements. The technical
foundation spike must validate the proposed credential storage and
transaction/policy integration. AI enablement additionally
requires verification of the external isolation contract; none of those
capabilities is assumed to exist today.
