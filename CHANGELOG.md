# Changelog

## Unreleased

- Record imports show their validation summary before committing. Deleting an
  import with labelled records requires confirming the labelled-record count.
- Workspace administrators manage accounts and audit events through the
  application's access rules. Password changes can send a confirmation email.
- AI jobs use a persisted polling deadline, retry transient polling failures,
  and validate suggestion paths before storage.
- The AI job badge and learning runs have bounded result sizes. Repeated
  transient start failures pause admission for that endpoint.
- Participant flags and record flags are independent. In an active double
  round, revised answers can confirm a taxonomy while reports preserve the
  first comparison.
- Invitation resends preserve the previous link when delivery fails. The
  outbox retries definite transient refusals with backoff.
- The queue validates date and level filters. Export errors appear on the page
  before a download starts.
- The container uses separate liveness and database-readiness endpoints.
  Browser tests connect as the runtime database role.
- Updated the authentication, web framework, browser test and build dependencies.
