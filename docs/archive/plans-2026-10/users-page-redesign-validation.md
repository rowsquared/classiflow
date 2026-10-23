# Users/workspaces redesign completion — 23 October 2026

Implementation and validation record for the completed redesign.

## Delivered

- Unified `/users` directory with global and scoped workspace views, server
  filtering/sorting/paging, access chips, separate account/setup/access states,
  merged editor, atomic role/supervisor edits, removal/restore and history.
- Email-first account creation and invitations, multi-workspace grants with
  failed-grant retry, CSV import/export, and redirects from legacy user pages.
- Shared global sidebar and bounded scrolling main column; sidebar navigation
  and dialogs remain usable at short viewport heights.
- Workspace counts, rename, archive/reopen, deletion preview and exact-name
  confirmation. Only platform admins can delete an archived workspace.
- Atomic child-first workspace deletion under runtime RLS, schema coverage,
  rollback verification and a platform audit with actual deletion counts.
  Accounts, approved endpoints and other workspaces remain. External Taxomind
  data remains; cancellation clients are captured before connection deletion.
- `/ai-services`, server-enforced account deletion guards, shared membership
  services, and updated architecture/security documentation.

## Validation

- Production build, type checking, lint and full format check passed.
- Unit suite: **149 passed across 27 files**.
- Full integration suite: **217 passed across 22 files**, using the runtime DB role.
- Full browser suite: **63 passed, 4 failed** on stale test assumptions/selectors.
  Corrected email login, workspace-chooser handling and ambiguous alert locator;
  final targeted rerun: **24 passed**, including all four corrected tests and
  the preceding state-changing Users journeys. All **67 browser tests** have
  passed across the full run and targeted rerun; none remain failing or skipped.
- Visual inspection confirmed the loaded editor and short-window sidebar;
  browser checks cover scrolling, invitations, membership lifecycle, deletion,
  partial-grant retry, scope isolation and axe accessibility.

## Remaining limitation

Optional live no-mail UI verification was not run: automatic approval review
rejected the extra test-server setup with only "blocked by policy" as its reason,
including a read-only attempt. No-mail behavior has implementation and backend
coverage; this additional browser variant remains unverified.

No implementation work remains from this redesign. The pre-existing decision
about workspace admins editing never-signed-in single-workspace accounts remains
in [open items](../../plans/open-items.md); the new editor keeps global account
controls platform-only.

## Reproducing checks

Use Node 24 and disposable PostgreSQL databases as described in
[integration checks](../../../tests/integration/README.md) and
[browser journeys](../../../tests/e2e/README.md). Run the production build before
browser tests. Integration checks use `TEST_DATABASE_URL`; browser tests use
`E2E_DATABASE_URL` and optionally `E2E_PORT`.
