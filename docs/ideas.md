# Improvement ideas

Product ideas we want eventually but have not planned. Move an item into
`docs/plans/` when someone picks it up.

## Independent double annotation

**Planned:** see the [implementation plan](plans/double-annotation.md)
(22 October 2026; proposed, not implemented). Two people annotate independently
inside one workspace, either simultaneously or with a second annotation added
later. The first label stays exportable as a provisional result while awaiting
the second annotation or review. The plan covers assignments, independent
submissions, review, exports, progress, AI learning, migration and testing.

## Deactivate users instead of deleting them

Users who wrote comments or started AI jobs cannot be deleted (their authorship
is kept), and deleting a labeller drops the attribution of their labels. A
`deactivatedAt` flag that blocks sign-in and hides the user from pickers, while
keeping history, would cover people who leave a project.

**Planned:** now part of [user management plan](archive/plans-2026-10/user-management.md) (U3).
