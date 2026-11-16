# Feature plans

Larger features under consideration. Release steps live in the
[Coolify guide](../COOLIFY_DEPLOYMENT.md#releases). Previous designs and
reviews are in [archive](archive/).

## Bulk work from a queue filter

Select all matching records across pages for a bulk operation. Show the
selection count and preview, apply the same workspace and participant rules
as the queue, and process the selection in bounded batches. This would replace
the 10,000-row “All” view for large bulk operations.

## Double-annotation workflows

Decide which workflow to add next. Candidates are repeat rounds, private
reviewer notes, configurable blind review, learning snapshots, recording
whether a labeller saw other labels, and revalidation when a taxonomy changes.
If confirmed results become manager-only, design the release workflow so it
preserves participant confidentiality and historical exports.

## Admin MFA and single sign-on

Design enrollment, recovery, and enforcement for administrator MFA and
organization-managed sign-in.

## Operations monitoring

Choose a log and trace backend and add alerts for elevated 5xx rates, stuck or
failed AI jobs, and failed mail. Decide how to route and acknowledge alerts.

## Taxomind collaboration

- **Namespace authorization.** Scope tokens to their workspace namespaces,
  including start, status and cancel. Until then, teams with untrusted
  workspace admins use a token held by a platform admin or their own instance.
- **Idempotent starts.** Taxomind should return the existing job when classiflow
  retries a start with the same key. Classiflow already sends a stable labeling
  batch ID. Add the key for learning and taxonomy sync with the new contract.
- **Taxonomy lifecycle.** Support deleting a taxonomy and its model in Taxomind,
  then call that operation when a workspace deletes a taxonomy.

See the [Taxomind integration plan](archive/taxomind-isolation.md) for the
proposed API changes and verification cases.
