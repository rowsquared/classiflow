# Changelog

## Unreleased

- Record imports show their validation summary before committing. Deleting an
  import with labelled records requires confirming the labelled-record count.
- Workspace administrators manage accounts and audit events through the
  application's access rules. Password changes can send a confirmation email.
- AI jobs use a persisted polling deadline, retry transient polling failures,
  and validate suggestion paths before storage.
- The container uses separate liveness and database-readiness endpoints.
  Browser tests connect as the runtime database role.
- Updated the authentication, web framework, browser test and build dependencies.
