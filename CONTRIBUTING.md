# Contributing to classiflow

Use GitHub issues for bugs and feature discussions. For a suspected
vulnerability, use the [private reporting process](SECURITY.md).

Follow the [local setup guide](DEVELOPMENT.md) to run the application with
Node.js 24, npm 11 and PostgreSQL 18. Keep Prisma packages on the same version
and commit dependency changes with the lockfile.

Base changes on `staging` and open pull requests against it. Describe the
behavior that changed and the checks you ran. Run typecheck, lint, formatting
and unit tests, plus the PostgreSQL integration or browser tests that cover
your changes. Add an integration test when an access rule or data invariant
changes.
