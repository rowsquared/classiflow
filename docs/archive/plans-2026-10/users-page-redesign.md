# One Users page, a real Workspaces page, workspace deletion

Status: implemented and verified (23 October 2026).
See [completion and validation](users-page-redesign-validation.md). The "Why" section describes the previous UI.
Replaces the earlier user/workspace management draft, whose implemented parts
are on `staging`; the rules from it that still matter are under "Rules to
keep" below.

Implementation decisions accepted during review:

- One scoped Users page for platform and workspace admins; old routes redirect.
- Separate account, password-setup and membership-access filters, including removed access.
  Pending workspace invitations remain separate from account/member rows.
- Role and supervisor save together with Save/Cancel controls. Workspace admins'
  profile and global sign-in controls are read-only in the new editor; the existing
  API exception remains pending the decision in `open-items.md`.
- Platform admins alone can look up an existing account by email. Workspace admins
  invite without an account lookup; without mail they can create a new account but
  need a platform admin to attach an existing one. Grants report separate outcomes
  and failed grants can be retried without recreating the account.
- Workspace deletion requires archive and exact-name confirmation. Use explicit
  child-first deletes in one transaction, with a schema-coverage integration test,
  rather than a cascade migration. Materialise AI clients before deleting their
  connection rows, then attempt cancellation outside the transaction. Taxomind data
  remains and is explicitly disclosed. The platform deletion audit commits with the
  deletion and records the actual counts, not a stale preview.
- User deletion is server-restricted to accounts without active workspace access
  or saved work/dependencies, including double annotation and AI history.
- Global shells own a bounded `h-dvh` scrolling main column. Access chips expand by
  click/keyboard/touch. Both directory views sort/filter/page on the server.
- Directory CSV exports all filtered pages; a selected workspace's member CSV
  exports all its members, including removed ones, and explains that scope.

## Why

Three places manage people today, and none of them is complete:

| Place | Who | What it does | Problem |
| --- | --- | --- | --- |
| `/team` (`AccountsClient`, also `/accounts`) | Platform admins | Global directory, add user, edit profile, workspace access in a modal | Called "Team", same word as the workspace page; no sidebar, so it feels like a different app; reached only from `/workspaces` |
| `/w/[id]/admin/team` ("Workspace members") | Workspace admins, platform admins | Role, supervisor, assignments, invitations, CSV import, removal | A second people table with different columns, filters and editor |
| `/workspaces` | Everyone | Chooser; for platform admins also "Manage users", create workspace, AI endpoints | Cannot scroll; no rename, archive or delete although the API supports rename and archive |

Bugs found while reading the code:

- **`/workspaces` and `/team` cannot scroll.** `app/layout.tsx` gives `<body>`
  `overflow-hidden` (the workspace shell scrolls its own main column). Both
  pages wrap their content in `min-h-screen overflow-auto`: `min-h` lets the
  div grow taller than the window, so its own scrollbar never appears, and the
  body hides the rest. Seen in the source, not reproduced in a browser.
- **No way to archive, rename or delete a workspace in the UI.**
  `PUT /api/workspaces/[id]` supports name, description and archive/reopen,
  but no screen calls it. There is no delete at all (API or database: the
  workspace foreign keys have no `ON DELETE CASCADE`, so a plain delete fails).

## What Survey Hub does (read at `survey-hub@650c698`)

- **Admin items in the same sidebar.** `components/layout/Sidebar.vue` lists
  the working pages, then two admin-only items, **Surveys** and **Users**. No
  separate admin app; the survey selector sits in the header.
- **Users page** (`pages/users.vue`): one sortable table (username, name,
  email, role, survey access, organisation, last seen, last sign-in, Edit).
  Above it: search, a survey-access filter including "No survey access", an
  account-status filter, Clear, and "N of M users". Header buttons **Upload
  users** (CSV import modal with template, preview and result CSV) and **Add
  user**. Admins show an **All surveys** chip instead of a list; other users
  show survey chips (first few, then `+N` with the rest in a tooltip).
  Inactive accounts are greyed and struck through.
- **Edit user modal**: profile, role with a one-line explanation ("only Admin
  changes what an account can reach"), new password, **Account is active**
  checkbox explained as the reversible alternative to deleting, API token, and
  a separate **Delete user** at the bottom with a warning that it removes
  comments.
- **Surveys page** (`pages/surveys.vue`): one card per survey with counts
  (users, interviews, targets) and **Edit**. The edit modal holds details, a
  **Users** section (search existing users, add, set access per user, remove)
  and **Delete survey** at the bottom.
- **Destructive confirm** (`components/common/ConfirmDeleteModal.vue`): lists
  exactly what goes, and for a survey requires typing its name.

What we take: admin pages in the normal sidebar, one people table with access
chips and an access filter, an editor modal with the account switch above a
separate delete, the workspace list with counts and a typed-name delete.
What we keep from classiflow: per-workspace roles and supervisors (Survey
Hub's page-permission grid does not fit), row security, membership removal
instead of deletion, and the platform admin / workspace admin split.

## Proposal

### 1. Navigation: one sidebar everywhere

Global pages (`/users`, `/workspaces`, `/ai-services`) get the same sidebar
as workspace pages. The workspace part of the sidebar is shown only inside a
workspace; an **Administration** group at the bottom is always there for
admins.

```text
┌────────────────────────┐
│ classiflow             │
│ ┌────────────────────┐ │
│ │ HIES 2015        ▾ │ │   workspace switcher (on global pages:
│ └────────────────────┘ │   "Choose a workspace ▾")
│                        │
│ ☰  Queue               │ ┐
│ ▥  Progress            │ │
│ ⌗  Taxonomy            │ │ this workspace
│ ▤  Sentences           │ │ (unchanged, minus "Workspace members")
│ ⤓  Export              │ │
│ ✦  AI jobs             │ │
│ ⚙  AI settings         │ │
│ ✓  Audit log           │ ┘
│                        │
│ ADMINISTRATION         │
│ 👥 Users               │   all admins (platform + workspace admins)
│ ▦  Workspaces          │   platform admins (others: plain chooser)
│ ⚡ AI services          │   platform admins
│                        │
│ (PB) Peter B.        ⋯ │
└────────────────────────┘
```

- `/team`, `/accounts` and `/w/[id]/admin/team` redirect to `/users`
  (the last one to `/users?workspace=<id>`), so old links keep working.
- "Workspace members" leaves the workspace group; its job moves to **Users**.
- Labellers and supervisors see no Administration group.

### 2. Users page (`/users`)

One page for every admin. What a row shows and what can be changed depends on
who is looking, enforced on the server:

- **Platform admin**: every account, every workspace.
- **Workspace admin**: only people with a membership (active or removed) in a
  workspace they administer, and only those workspaces' chips and controls.
  Nothing reveals other workspaces or their names.

#### 2a. All workspaces (default view)

```text
Users                                        [Import CSV]  [Export CSV]  [+ Add user]
People and their access to workspaces. Roles are set per workspace.

[🔍 Search name or email      ] [Workspace: Any ▾] [Role: Any ▾] [Status: Active ▾]  Clear
                                                                       128 of 131 users
┌───────────────────────┬───────────────────────────┬──────────────────────────────────────┬─────────────┬────────┐
│ Name ▲                │ Email                     │ Workspaces                           │ Last sign-in│        │
├───────────────────────┼───────────────────────────┼──────────────────────────────────────┼─────────────┼────────┤
│ Peter Brückmann       │ p.brueckmann@…            │ [All workspaces · platform admin]    │ today       │ Edit   │
│ Alex Moreno           │ alex@example.org          │ [HIES 2015 · supervisor] [LFS · lab…]│ 2 days ago  │ Edit   │
│ Sam Okafor            │ sam@example.org           │ [LFS · labeller] [+2]                │ 3 weeks ago │ Edit   │
│ Dana Li   ⏳ setup    │ dana@example.org          │ [HIES 2015 · labeller]               │ never       │ Edit   │
│ R. Ndlovu  Disabled   │ r.ndlovu@example.org      │ —  no workspace                      │ 4 months ago│ Edit   │
└───────────────────────┴───────────────────────────┴──────────────────────────────────────┴─────────────┴────────┘
                                                                 ‹ Previous   Page 1 of 3   Next ›
```

- Chips: `workspace · role`, first three then `+N` (tooltip lists the rest).
  Removed memberships are not chips; archived workspaces show a grey chip.
  Platform admins show one chip **All workspaces · platform admin**, as
  Survey Hub does for admins.
- Filters: Workspace (Any / No workspace / each workspace), Role (only with a
  workspace chosen), Status (Active, Password setup pending, Invitation
  pending, Disabled, Everyone). In the URL with nuqs, server-paged as today.
- Disabled accounts are greyed; the badge says **Disabled**.
- Username moves out of the table (shown in the editor as "Sign-in alias").

#### 2b. One workspace (Workspace filter set, or arriving from a workspace)

Choosing a workspace swaps the access column for that workspace's working
columns, which are today's "Workspace members" table:

```text
Users                                        [Import CSV]  [Export CSV]  [+ Add user]

[🔍 Search        ] [Workspace: HIES 2015 ▾] [Role: Any ▾] [Supervisor: Any ▾] [Status: Active ▾] [Activity: Any ▾]
                                                                       24 of 24 members
┌──────────────────┬──────────────────┬────────────┬──────────────┬──────┬──────────┬────────────┬────────┐
│ Name ▲           │ Email            │ Role       │ Supervisor   │ Team │ Assigned │ Last seen  │        │
├──────────────────┼──────────────────┼────────────┼──────────────┼──────┼──────────┼────────────┼────────┤
│ Alex Moreno      │ alex@example.org │ Supervisor │ Peter B.     │ 6    │ 0        │ today      │ Edit   │
│ Sam Okafor       │ sam@example.org  │ Labeller   │ Alex Moreno  │ —    │ 412      │ yesterday  │ Edit   │
│ Dana Li ✉ invited│ dana@example.org │ Labeller   │ Alex Moreno  │ —    │ 0        │ never      │ Edit   │
└──────────────────┴──────────────────┴────────────┴──────────────┴──────┴──────────┴────────────┴────────┘
Pending invitations (2)   ▸                                   (collapsible, from PendingInvitations)
```

- The workspace sidebar's **Users** link opens this view for the current
  workspace; Import CSV and Add user then default to that workspace.
- A workspace admin who administers exactly one workspace always lands here
  and the Workspace filter shows just that one.

#### 2c. Edit user (modal, one per person)

Replaces both `AccountsClient`'s edit modal and `MemberDrawer`. Sections are
shown only when the viewer may use them.

```text
┌─ Alex Moreno ──────────────────────────────────────────────────────── ✕ ─┐
│ alex@example.org · sign-in alias: amoreno · last sign-in 2 days ago      │
│                                                                          │
│ Profile                                    (applies in every workspace)  │
│ Name   [Alex Moreno                ]                                     │
│ Email  [alex@example.org           ]                                     │
│                                                       [Save profile]     │
│ ──────────────────────────────────────────────────────────────────────── │
│ Workspace access                                                         │
│ ┌────────────┬──────────────┬────────────────┬──────────┬─────────────┐  │
│ │ Workspace  │ Role         │ Supervisor     │ Assigned │             │  │
│ ├────────────┼──────────────┼────────────────┼──────────┼─────────────┤  │
│ │ HIES 2015  │ [Supervisor▾]│ [Peter B.    ▾]│ 0        │ Remove      │  │
│ │ LFS 2024   │ [Labeller  ▾]│ [Sam Okafor  ▾]│ 37       │ Remove      │  │
│ │ CPI pilot  │ removed 3 Oct│                │          │ Restore     │  │
│ └────────────┴──────────────┴────────────────┴──────────┴─────────────┘  │
│ [+ Add to workspace ▾]                    each row saves on change       │
│ ▸ History in HIES 2015 (labels, last seen, removed records)              │
│ ──────────────────────────────────────────────────────────────────────── │
│ Sign-in                                                                  │
│ [Send password link]  [Set temporary password]  [Sign out everywhere]    │
│ ──────────────────────────────────────────────────────────────────────── │
│ Platform                                           (platform admins only)│
│ [ ] Platform administrator — admin in every workspace, now and later     │
│ [✓] Account enabled — untick to block sign-in and end sessions now;      │
│     memberships, labels and comments are kept                            │
│ ──────────────────────────────────────────────────────────────────────── │
│ Delete user…                       only for accounts with no work saved  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Remove** opens today's removal confirm (unassign open records or keep
  them); last-admin and self-removal guards stay.
- A workspace admin sees only their workspaces' rows, no Platform section,
  and Profile read-only (except the existing never-signed-in exception,
  which `open-items.md` already lists for a decision).
- **Delete user** is enabled only when the account has no annotations,
  comments, labelling activity or audit entries as actor; otherwise the
  button is disabled with "Disable the account instead: it has saved work".
  Same reasoning as Survey Hub's comment, stricter rule because classiflow's
  labels are the product.

#### 2d. Add user (modal)

```text
┌─ Add user ─────────────────────────────────────────────────────────── ✕ ─┐
│ Email  [dana@example.org            ]                                    │
│        ✓ No account yet — a new one will be created                      │
│        (or: "Dana Li already has an account. Add workspace access only.")│
│ Name   [Dana Li                     ]                                    │
│                                                                          │
│ Workspace access                                                         │
│ [HIES 2015 ▾]  [Labeller ▾]  [Alex Moreno ▾]   ✕                         │
│ [+ another workspace]                                                    │
│                                                                          │
│ How they get in                                                          │
│ (•) Email a link to set a password      ( ) Show a temporary password    │
│                                                                          │
│                                          [Cancel]   [Add user]           │
└──────────────────────────────────────────────────────────────────────────┘
```

- Platform admins: the email check reuses an existing account (never
  overwrites it), as the current create path already does.
- Workspace admins: the workspace list holds only their workspaces; for an
  existing account the dialog says "an invitation will be sent" without
  revealing anything else about that account (current invitation rules).
- Without mail configured, only "Show a temporary password" is offered.
- The result screen lists each workspace grant with its outcome, as now.

Import CSV is today's `MemberImportModal` (template, preview, result CSV),
opened from this page with the workspace taken from the filter or chosen in
the dialog.

### 3. Workspaces page (`/workspaces`)

Ordinary users: the chooser, unchanged apart from the scroll fix. Platform
admins: a management list in Survey Hub's style, with the sidebar.

```text
Workspaces                                                  [+ New workspace]
Each workspace is a separate classification exercise.

[Status: Active ▾]                                                    5 workspaces
┌──────────────────────────────────────────────────────────────────────────────┐
│ HIES 2015                                              Open   Edit   ⋯       │
│ Household income and expenditure, ISCO + COICOP                              │
│ Members 24 · Records 18,402 · Submitted 61% · Taxonomies 2 · AI on           │
├──────────────────────────────────────────────────────────────────────────────┤
│ LFS 2024                                               Open   Edit   ⋯       │
│ Members 9 · Records 3,110 · Submitted 12% · Taxonomies 1                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ CPI pilot                     Archived · read-only     Open   Edit   ⋯       │
│ Members 3 · Records 250 · Submitted 100% · archived 3 Oct 2026               │
└──────────────────────────────────────────────────────────────────────────────┘
   ⋯ menu: Manage users (→ /users?workspace=…) · Archive / Reopen · Delete…
```

Edit workspace (modal): name, description, and a danger zone.

```text
┌─ Edit workspace ───────────────────────────────────────────────────── ✕ ─┐
│ Name         [HIES 2015                         ]                        │
│ Description  [Household income and expenditure… ]                        │
│                                                      [Save]              │
│ ──────────────────────────────────────────────────────────────────────── │
│ Archive                                                                  │
│ Makes the workspace read-only and cancels running AI jobs. Reversible.   │
│                                                      [Archive]           │
│ ──────────────────────────────────────────────────────────────────────── │
│ Delete                                                                   │
│ Only archived workspaces can be deleted.            [Delete…] (disabled) │
└──────────────────────────────────────────────────────────────────────────┘
```

Delete confirm (Survey Hub's typed confirmation):

```text
┌─ Delete workspace ─────────────────────────────────────────────────── ✕ ─┐
│ This permanently deletes "CPI pilot" and everything in it:               │
│   250 records, 412 labels, 38 comments, 2 taxonomies (1,204 codes),      │
│   3 memberships, 6 AI jobs, its AI connection and its audit log.         │
│ User accounts are kept. Export the records first if you need them.       │
│ This cannot be undone.                                                   │
│                                                                          │
│ Type CPI pilot to confirm  [                    ]                        │
│                                          [Cancel]  [Delete workspace]    │
└──────────────────────────────────────────────────────────────────────────┘
```

Workspace admins who are not platform admins keep archive/reopen and rename
for their own workspaces (the API already allows it) through the same Edit
modal, reached from a small "Workspace settings" link in the switcher menu.
Delete stays platform-admin only.

The AI endpoints panel moves from `/workspaces` to **AI services**
(`/ai-services`), unchanged in content.

### 4. Workspace deletion (backend)

- `DELETE /api/workspaces/[workspaceId]`, `requirePlatformAdmin()`; refuses
  unless the workspace is archived (409) and the body carries the exact name.
- `deleteWorkspace()` in `lib/server/workspaces.ts`: lock the workspace row,
  re-check archived, delete in one transaction. Two ways to do the deleting;
  recommendation first:
  1. **Migration adding `ON DELETE CASCADE`** to every `workspaceId → Workspace`
     foreign key (and keeping the composite in-workspace keys as they are), so
     `DELETE FROM "Workspace"` removes everything. Must confirm on a test
     database that the composite `NO ACTION` keys and row security do not
     block the cascade, and that the least-privilege runtime role may delete.
  2. Explicit deletes table by table inside `withWorkspace()`, children
     first. No schema change, but every new workspace table must be added to
     the list (an integration test that compares the list with the schema
     would guard that).
- Before deleting: cancel running AI jobs (reuse the archive path, which has
  already done it since only archived workspaces qualify). Whether to ask
  Taxomind to drop the namespace `<slug>--<workspaceId>` is a question for
  the Taxomind side; first version leaves it and logs it.
- Platform audit entry `workspace.deleted` (workspace null) with name and the
  counts shown in the dialog, written in the same transaction. The
  workspace's own audit log goes with it; that is what the dialog says.
- Pending `OutgoingMail` and `WorkspaceInvitation` rows for the workspace go
  too; `AIEndpointGrant` already cascades.
- `GET /api/workspaces/[id]/deletion-preview` returns the counts for the
  dialog (one query per table, fixed count).

### 5. Scroll fix

Change the two page roots from `min-h-screen overflow-auto` to
`h-dvh overflow-y-auto` (`app/workspaces/page.tsx`,
`app/accounts/AccountsClient.tsx`). Once global pages use the sidebar shell,
they scroll in its main column like workspace pages do and the wrapper goes
away. This is a one-line change worth shipping before everything else.

## Rules to keep

Carried over from the earlier draft; the new screens must not change them.

- **Identity.** `User.id` is the identity; email is the lookup key,
  normalised with `trim().toLowerCase()` everywhere (create, lookup, invite,
  import, update), without stripping dots or plus suffixes. Changing an email
  never merges accounts or moves memberships. Usernames stay as a sign-in
  alias; new accounts get a generated one.
- **No global workspace role.** Roles and supervisors exist only per
  membership. Forms say **Workspace role** and **Platform administrator**,
  never a bare "Role" in the global editor. A platform admin keeps admin
  access to every workspace whatever their explicit membership says; show
  that before saving a change to it.
- **Separate states.** Account enabled/disabled (global), membership
  active/removed (per workspace), workspace active/archived, password setup
  pending and invitation pending are different things and shown separately.
- **Adding access.** An existing account is reused, never overwritten (name,
  credentials, sessions, other memberships unchanged). Adding an already
  active membership changes nothing; role and supervisor change only by
  editing. A removed membership is restored on the same row (assignments and
  team links point at its ID), with the supervisor re-checked. Never default a
  new grant to workspace admin. Refuse grants to disabled accounts and writes
  to archived workspaces with a clear message.
- **Several workspaces at once.** Each grant is its own workspace
  transaction: show the result per workspace and offer retry for failures.
  If the account was created but a grant failed, say so; never ask to create
  the account again.
- **Workspace admins and existing accounts.** They invite by email and get
  the same response whether an account exists or not; they cannot browse or
  search global accounts. Invitation acceptance re-checks token, expiry,
  revocation, inviter authority, account and workspace state and supervisor.
- **One implementation of the rules.** Both views of a membership (person
  editor and one-workspace table) call the same server services in
  `lib/server/memberships.ts`, inside `withWorkspace()`, with audit entries.
  Hiding a control is never the permission check.
- **Offboarding.** Removal keeps labels, comments and history and offers to
  unassign unsubmitted records; self-removal and last-admin guards stay.
  Disabling uses the existing ban and session revocation.
- **Open decision** (in `open-items.md`): retiring the exception that lets a
  workspace admin edit the global profile of a never-signed-in,
  single-workspace account. If retired, change the API too and update
  `docs/security.md` with an integration test.

## Permission summary

| Action | Platform admin | Workspace admin | Others |
| --- | --- | --- | --- |
| Open `/users` | All accounts | Members of their workspaces | No |
| Add user / grant access | Any workspace | Their workspaces (invite for existing accounts) | No |
| Role, supervisor, remove, restore | Any workspace | Their workspaces | No |
| Edit profile, disable, platform admin, delete user | Yes | No (existing exception pending decision) | No |
| Workspaces list with management | Yes | Chooser + settings of their own | Chooser |
| Rename, archive, reopen workspace | Yes | Their workspaces | No |
| Delete workspace | Yes (archived only, typed name) | No | No |

The workspace-admin view of `/users` is a new read scope and must be added to
`docs/security.md` with integration tests (cannot see users or chips of other
workspaces; cannot write to other workspaces' memberships).

## Build order

Each step is shippable on its own.

1. **Scroll fix** on `/workspaces` and `/team`.
2. **Global shell**: sidebar on global pages, Administration group, `/users`
   route rendering today's `AccountsClient`; redirects from `/team` and
   `/accounts`. AI endpoints panel to `/ai-services`.
3. **Users page, platform admin**: access chips, workspace filter,
   one-workspace columns (2b) using `lib/server/global-users.ts` plus the
   membership data `listVisibleUsers` already computes; the merged editor
   (2c) built from `WorkspaceAccess` and the role/supervisor/history parts of
   `MemberDrawer`; Add user (2d) on the existing create paths.
4. **Users page, workspace admins**: server scope, then redirect
   `/w/[id]/admin/team` to `/users?workspace=<id>` and drop "Workspace
   members" from the sidebar. Retire `TeamPageClient` and `MemberDrawer`.
5. **Workspaces management**: list with counts, Edit modal (rename,
   archive/reopen) on the existing `PUT`.
6. **Workspace deletion**: preview endpoint, delete endpoint and service,
   migration if option 1, typed-name dialog.

Tests per step: add `/users` (both views and the editor), `/workspaces` and
the delete dialog to `tests/e2e/accessibility.spec.ts`; integration tests for
the workspace-admin scope (step 4) and for deletion (step 6: everything in the
workspace gone, other workspaces and accounts untouched, refused when active,
refused for workspace admins).

## Questions for review

1. **Workspace admins on `/users`** (recommended) or keep a separate members
   page for them and make `/users` platform-only? The single page is what was
   asked for; the cost is the new scoped read in step 4.
2. **Hard delete of workspaces**: archive first, then delete (proposed), or
   allow deleting an active workspace directly?
3. **Delete user**: only for accounts with no saved work (proposed), or not at
   all (disable only)?
4. **Taxomind data** of a deleted workspace: leave it (proposed for v1) or
   ask Taxomind to drop the namespace?
