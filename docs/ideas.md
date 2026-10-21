# Improvement ideas

Product ideas we want eventually but have not planned. Move an item into
`docs/plans/` when someone picks it up.

## Independent double annotation

**Today:** a record has one human label set per taxonomy. Saving replaces it,
whoever saved last.

**Wanted:** two or more labellers classify the same record independently, then
agreement is measured and disagreements go to a supervisor for adjudication.

Rough shape: annotations keyed by `(sentence, taxonomy, level, annotator)`, a
per-assignment completion state, an adjudicated "final" label set that export
and learning use, agreement metrics on the progress page, and a queue filter for
records awaiting adjudication. Needs a migration of the unique constraint and
changes to completion rules, export columns and AI learning input.

## Deactivate users instead of deleting them

Users who wrote comments or started AI jobs cannot be deleted (their authorship
is kept), and deleting a labeller drops the attribution of their labels. A
`deactivatedAt` flag that blocks sign-in and hides the user from pickers, while
keeping history, would cover people who leave a project.
