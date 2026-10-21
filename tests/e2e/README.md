# Browser journeys

Playwright drives a production build in Chromium against a disposable
database: sign-in, queue search (debounce, superseded requests, error banner and
retry), dialog keyboard behaviour, labelling with the keyboard, and the CSV
export. `global-setup.ts` migrates the database, then runs `seed.ts` with plain
Node (Prisma 7's client is ES modules) to empty it and seed an admin, a
two-level taxonomy and three records. The Content-Security-Policy is enforced,
and any violation fails a journey.

```bash
createdb classiflow_e2e_test          # once; the name must end in _test
npm run build
E2E_DATABASE_URL=postgresql://classiflow:classiflow_password@localhost:5434/classiflow_e2e_test npm run test:e2e
```

The server runs on port 3200 (`E2E_PORT` to change). Failures keep a trace in
`test-results/` (`npx playwright show-trace <file>`). CI runs the same in the
`e2e` job and uploads the report when it fails.
