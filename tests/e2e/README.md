# Browser journeys

Playwright drives a production build in Chromium against a disposable
database: sign-in, queue search (debounce, superseded requests, error banner and
retry), dialog keyboard behaviour, labelling with the keyboard, comments,
record import, the CSV export and audit log, the Team and Accounts pages
(`journeys.spec.ts`); bulk labelling (`labelling-bulk.spec.ts`); taxonomy
administration (create from a CSV with leading-zero codes, browse, incremental
import, edit, delete; `taxonomy-admin.spec.ts`); the queue view in the URL
(reload, back/forward) and the workspace switcher (`queue-url.spec.ts`); the
Progress dashboard (period, team and person filters in the URL, a failing
section with Retry, keyboard sorting, the chart's table alternative, the time
zone dialog; `progress.spec.ts`); and
axe-core on the main pages (`accessibility.spec.ts`, helper `a11y.ts`), which
fails on serious or critical findings. There are no accepted exceptions; if
one is ever needed, it goes in `KNOWN` in `a11y.ts` with the file that needs
the fix. `global-setup.ts` migrates the database, then runs `seed.ts`
with plain Node (Prisma 7's client is ES modules) to empty it and seed an
admin, a two-level taxonomy and three records. The Content-Security-Policy is
enforced, and any violation fails a journey (`failOnCspViolations()` in
`helpers.ts`).

The files share that one database and run one after another in file name
order; each data journey's header says what it expects from the earlier ones
and what it leaves behind, and the read-only specs must not depend on those
changes.

```bash
createdb classiflow_e2e_test          # once; the name must end in _test
npm run build
E2E_DATABASE_URL=postgresql://classiflow:classiflow_password@localhost:5434/classiflow_e2e_test npm run test:e2e
```

The server runs on port 3200 (`E2E_PORT` to change) with mail on: it posts to
a stand-in for the n8n workflow that `mail.spec.ts` runs on the next port
(3201), so the invitation journey can read the link from the mail. Failures keep a trace in
`test-results/` (`npx playwright show-trace <file>`). On Windows, artifacts go to
`%TEMP%/classiflow-e2e/<checkout-hash>/` to avoid locked download files under
Desktop checkouts; the hash keeps concurrent worktrees separate. CI runs the same in the
`e2e` job and uploads the report when it fails.

`review-regressions.spec.ts` exercises failure and edge cases in its own temporary
workspaces (archived after each test): draft retention, out-of-order labeling,
failed writes, nested dialogs, large taxonomies, selection across pages, partial
assignments, member import and reporting-time-zone retries.
