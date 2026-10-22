# Taxomind: isolation and robustness (long term)

**Status:** not scheduled, 22 October 2026. Work in the separate
[Taxomind](https://github.com/rowsquared/taxomind) repository, plus a small
follow-up here. Not needed to use AI on staging or for workspaces run by our
own team; needed before AI is offered to an organisation whose workspace
admins we do not fully trust.

## Where things stand

classiflow gives every workspace its own model namespace,
`<AI_SOURCE_SLUG>--<workspaceId>`, set on the server when the connection is
saved; users cannot change it. Each workspace stores its own Taxomind token,
encrypted and write-only (never shown again after saving). Platform admins
choose which approved Taxomind services each workspace may use ("Access" on
the Workspaces page).

On the Taxomind side (read 22 October 2026: `services/api/auth.py`,
`config.py`, `request_source.py`, `routers/labeling.py`; the model storage was
not reviewed):

- Tokens are a flat allow-list (`API_TOKENS`, comma-separated). Every valid
  token is accepted for every namespace.
- The namespace is the `sourceSlug` in the request body
  (`resolve_source_slug`), and model keys are built from it
  (`scoped_taxonomy_key`).
- `/label` creates a new job (`uuid4`) for every request, even for a
  `batchId` it has seen before. `/learn` has no batch id.
- `POST /taxonomies` supports `action: 'create'` only; there is no delete.

So the namespaces keep workspaces apart as long as only classiflow talks to
Taxomind. Anyone who holds a token can call Taxomind directly with another
workspace's namespace (workspace ids are not secret) and read its
suggestions, train its model with bad labels, or replace its taxonomy.

## Until this is done

- Workspaces run by our own team: no restriction.
- A workspace whose admins should not reach other workspaces' models: a
  **platform admin** enters the token in that workspace's AI settings, so its
  admins never see it. Separate tokens per workspace do not help on their own
  (every token is valid for every namespace).
- An organisation that must be fully separated: its own Taxomind instance,
  approved only for its workspace ("Access").

## Work

### 1. Bind tokens to namespaces (the actual fix)

In Taxomind: configure each token with the namespace prefixes it may use
(for example `token:classiflow-app-rowsquared--*`, or one workspace's exact
namespace) and refuse any other `sourceSlug` with 403. Status and cancel
requests check the job's stored namespace against the token too. Keep the
flat list working for one deployment-wide token during the transition.

Size: small to medium, roughly half a day to a day with tests (config
parsing, the auth dependency returning the token's scopes, a check in
`resolve_source_slug` and in each router's status/cancel).

classiflow side: nothing required. Optionally a note in the AI settings that
the token must be issued for this workspace's namespace (it is shown there).

Then verify live: two namespaces, identical taxonomy keys, two tokens; each
token is refused on the other's namespace, and neither sees the other's
models.

### 2. Idempotent job start (W07)

In Taxomind: `/label` returns the existing job for a repeated
`(sourceSlug, batchId)` instead of starting a new one (a Redis key next to the
job store); `/learn` gets an optional `batchId` with the same rule.

classiflow side: send the job id as `batchId` on `/learn` too
(`startLearning` in `lib/ai-job-monitor.ts`) and refresh the OpenAPI snapshot
(`lib/contracts/taxomind.openapi.json`).

Size: a few hours. Today, if a classiflow instance dies after `POST /label`
succeeded but before it saved Taxomind's job id, recovery sends the batch
again: wasted work, not wrong results.

### 3. Taxonomy delete

In Taxomind: `action: 'delete'` on `/taxonomies` (or a `DELETE` route) that
removes the namespace's taxonomy and its model.

classiflow side: a fourth job kind (or a call after the delete commits),
the way the removed `aiNotified` call used to work.

Size: depends on Taxomind's model storage (not reviewed). Until then a
deleted taxonomy's model stays in Taxomind until a sync with the same key
replaces it.

## Done when

Tokens are bound to namespaces and verified live, starts are idempotent,
deleting a taxonomy removes its model, and the classiflow OpenAPI snapshot
and stub (`tests/integration/ai-job-monitor.test.ts`) match the new contract.
